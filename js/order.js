/* Gifty. The order, written straight to the database from the browser.
 *
 * There is no server any more. There was a Cloudflare Worker holding an image
 * host key, a mail key and the one identity allowed to write an order; all
 * three are gone and this file replaces the only part that mattered.
 *
 * THE IMAGES RIDE INSIDE THE DATABASE, not in a file bucket. Cloud Storage
 * needs a paid plan on this project, so every image is base64'd and split
 * across an "assets" subcollection under the order. A document caps at
 * 1,048,576 bytes; the chunks are 620,000 characters, which leaves room for
 * the envelope. This is the pattern the careers form on the agency site has
 * been running on, copied deliberately rather than reinvented.
 *
 * THE ORDER GOES FIRST AND THE CHUNKS AFTER, and the order is the safety
 * story. Written parent first, a failure part way through leaves an order the
 * admin can SEE, with the buyer's name and number intact and an image it
 * reports as incomplete. Written chunks first it would leave the opposite:
 * chunks under an order that does not exist, which nothing can list, show or
 * delete, sitting in the quota forever. Visible and imperfect beats invisible
 * and tidy. Every item declares its chunk counts up front so the admin can
 * compare what it expects against what it actually finds.
 *
 * WHAT THIS FILE DOES NOT DO, on purpose: it does not decide the price. The
 * rules bound every line against the live product document, and the cart
 * priced it with the same js/price.js the customizer drew with. There is no
 * second implementation to drift from any more.
 *
 * EVERY WRITE CARRIES AN IDENTITY as of v0.3.4. The checkout mints an anonymous
 * Firebase account for itself, uses it once and throws it away. The buyer never
 * sees it, there is no password and no account to manage, and it is the whole
 * of the bot story: a plain curl loop cannot write an order any more, every
 * attempt goes through Firebase Auth's own abuse detection, and the rules make
 * one identity worth exactly one order.
 *
 * THE ORDER IS SPLIT IN THREE, and the split is a privacy decision, not a
 * storage one. orders/{n} is what a tracking link may show. The name, the
 * phone, the email, the address, the note and the payment reference go into
 * orders/{n}/private/details, which only the shop can read. The proof goes into
 * assets, which the buyer can see; the print file and the buyer's own
 * photograph go into print, which they cannot. Nothing reassembles the two.
 */
(function (G) {
  'use strict';

  var Order = G.Order = {};

  /* 620,000 characters of base64 leaves about 400 KB of headroom under the
     1,048,576 byte document ceiling once the field names and the envelope are
     counted. Five to a commit keeps every request far under the 10 MiB cap
     Firestore puts on a write REQUEST, which is a different ceiling from the
     one on a document and the one people forget. */
  var CHUNK_CHARS = 620000;
  var CHUNKS_PER_COMMIT = 5;

  /* The buyer's own photo, which is the only thing here that cannot be drawn
     again from the saved design. 2 MB of file is 2.8 MB of base64 and five
     chunks. The free tier is 1 GiB for the whole database, so this is a
     storage decision as much as a size one. */
  var PHOTO_MAX_EDGE = 1600;
  var PHOTO_QUALITY = 0.82;

  var key = (window.GIFTY_CONFIG && window.GIFTY_CONFIG.apiKey) || '';

  function commitUrl() {
    return G.Data.base.replace(/\/documents$/, '/documents:commit') +
           (key ? '?key=' + encodeURIComponent(key) : '');
  }

  /* ------------------------------------------------------------------- who

     An anonymous Firebase account, minted on the spot. No password, no email,
     no account for the buyer to manage or lose, and nothing kept after the
     page closes.

     It exists so that a write costs an identity. Every order write and every
     order read now needs one, which is what took the site from "an
     unauthenticated POST in a loop drains the daily quota" to "an attacker has
     to keep minting accounts in front of Google's abuse detection".

     The token is cached for the page, because a tracking page reads the order
     and then its pictures and one identity does for both. `fresh` skips the
     cache, and the checkout asks for a fresh one, so an order and its throttle
     document always agree about who placed it.

     GIFTY_AUTH_BASE points this at the Auth emulator when the dev server is
     running in emulator mode, exactly the way GIFTY_FIRESTORE_BASE points the
     reads at the Firestore one. The repo has no idea either exists. */

  var Auth = G.Auth = {};
  var pending = null;

  Auth.anon = function (fresh) {
    if (pending && !fresh) return pending;
    var base = window.GIFTY_AUTH_BASE || 'https://identitytoolkit.googleapis.com/v1';
    var p = fetch(base + '/accounts:signUp' +
                  (key ? '?key=' + encodeURIComponent(key) : ''), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ returnSecureToken: true })
    })
      .then(function (res) { return res.json(); })
      .then(function (body) {
        if (!body || !body.idToken) {
          var m = (body && body.error && body.error.message) || 'no token';
          throw new Error('anonymous sign in failed: ' + m);
        }
        return { token: body.idToken, uid: body.localId };
      });
    if (!pending || fresh) pending = p;
    return p;
  };

  /* Everything that talks to the database from this file goes through here, so
     there is one place that knows an identity is required and one place that
     would have to be changed if that ever stopped being true. */
  function withAuth(who, init) {
    init = init || {};
    init.headers = Object.assign({}, init.headers || {});
    if (who && who.token) init.headers.Authorization = 'Bearer ' + who.token;
    return init;
  }

  /* ---------------------------------------------------------------- encoding

     Firestore's REST shape is typed. js/data.js already decodes it; this is the
     other direction, and it throws on a nested array rather than letting the
     API answer with an opaque 400. A quad is four {x,y} maps for this reason. */

  function encode(v, path) {
    path = path || '$';
    if (v === null || v === undefined) return { nullValue: null };
    if (typeof v === 'string') return { stringValue: v };
    if (typeof v === 'boolean') return { booleanValue: v };
    if (typeof v === 'number') {
      if (!isFinite(v)) throw new Error(path + ' is not a finite number');
      return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    }
    if (Array.isArray(v)) {
      return {
        arrayValue: {
          values: v.map(function (item, i) {
            if (Array.isArray(item)) throw new Error(path + '[' + i + '] is an array inside an array');
            return encode(item, path + '[' + i + ']');
          })
        }
      };
    }
    return { mapValue: { fields: fieldsOf(v, path) } };
  }

  function fieldsOf(obj, path) {
    var out = {};
    Object.keys(obj).forEach(function (k) { out[k] = encode(obj[k], (path || '$') + '.' + k); });
    return out;
  }

  Order.encode = encode;

  /* ---------------------------------------------------------------- chunking */

  /* The WHOLE data URL is chunked, prefix included, not just the base64 after
     the comma. It costs about twenty characters and it means reassembly never
     has to know whether it is holding a JPEG proof or a PNG print file: join
     the parts and the string is already a usable src. */
  function chunk(text) {
    var parts = [];
    for (var at = 0; at < text.length; at += CHUNK_CHARS) {
      parts.push(text.slice(at, at + CHUNK_CHARS));
    }
    return parts;
  }

  /* The buyer's photo at print resolution but not at phone camera resolution.
     A 4000px original is four times the storage of a 1600px one and no press
     asks for it on a mug. Returns a data URL. */
  Order.shrink = function (img, maxEdge, quality) {
    var w = img.naturalWidth || img.width;
    var h = img.naturalHeight || img.height;
    var scale = Math.min(1, (maxEdge || PHOTO_MAX_EDGE) / Math.max(w, h));
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * scale));
    c.height = Math.max(1, Math.round(h * scale));
    var ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', quality || PHOTO_QUALITY);
  };

  /* --------------------------------------------------------------- the write */

  function orderNumber(prefix) {
    /* SIX digits, not five, as of v0.3.4. The tracking link needs no login by
       design, so the number is the only thing standing between a stranger and
       someone else's order page. Five digits is ninety thousand, which a script
       walks in an afternoon. Six is nine hundred thousand, it is still short
       enough to read down a phone, and it is now guarding a document that
       carries no name, no phone and no address. */
    return prefix + '-' + (100000 + Math.floor(Math.random() * 900000));
  }

  function commit(writes, who) {
    return fetch(commitUrl(), withAuth(who, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ writes: writes })
    })).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (out) {
        if (!res.ok) {
          var err = new Error((out.error && out.error.message) || ('commit returned ' + res.status));
          err.status = res.status;
          err.firestore = (out.error && out.error.status) || '';
          throw err;
        }
        return out;
      });
    });
  }

  function docPath(rest) {
    return G.Data.base.replace(/^.*\/v1\//, '') + '/' + rest;
  }

  /* A true create, not an upsert.

       currentDocument.exists = false   makes a duplicate order number a 409
                                        instead of quietly overwriting somebody
       updateTransforms REQUEST_TIME    is the only way createdAt can equal
                                        request.time, which the rule insists on,
                                        because the browser cannot know the
                                        server's clock before it writes */
  /* What a tracking link may show, and what only the shop may. One object in,
     two documents out, and this function is the only place that knows which
     field goes where. Getting it wrong is a privacy bug, so it is written once,
     here, rather than at the four call sites that assemble an order. */
  function split(order) {
    return {
      open: {
        orderNumber: order.orderNumber,
        status: order.status,
        uid: order.uid,
        delivery: {
          zone: order.delivery.zone,
          zoneName: order.delivery.zoneName,
          promisedDate: order.delivery.promisedDate,
          fee: order.delivery.fee
        },
        items: order.items,
        totals: order.totals,
        statusHistory: order.statusHistory
      },
      shut: {
        buyer: order.buyer,
        address: order.delivery.address,
        payment: order.payment,
        notes: order.notes == null ? null : order.notes
      }
    };
  }

  Order.split = split;

  /* One atomic commit: the order, who and where, and the throttle document that
     spends this identity.

       currentDocument.exists = false   makes a duplicate order number a 409
                                        instead of quietly overwriting somebody
       updateTransforms REQUEST_TIME    is the only way createdAt can equal
                                        request.time, which the rule insists on,
                                        because the browser cannot know the
                                        server's clock before it writes

     All three together on purpose. An order that lands without its address is
     an order the shop cannot deliver, and a throttle document that lands
     without its order would lock a buyer out of the checkout they just failed
     to complete. Either all of it or none of it. */
  function createOrder(number, order, who) {
    var parts = split(order);
    var writes = [
      {
        update: { name: docPath('orders/' + number), fields: fieldsOf(parts.open) },
        updateMask: { fieldPaths: Object.keys(parts.open) },
        updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
        currentDocument: { exists: false }
      },
      {
        update: {
          name: docPath('orders/' + number + '/private/details'),
          fields: fieldsOf(parts.shut)
        },
        updateMask: { fieldPaths: Object.keys(parts.shut) },
        currentDocument: { exists: false }
      }
    ];

    /* No identity means the emulator, where there is no sign in endpoint to
       call. Skip the throttle rather than write one keyed on nothing. */
    if (who && who.uid) {
      writes.push({
        update: {
          name: docPath('throttle/' + who.uid),
          fields: fieldsOf({ order: number })
        },
        updateMask: { fieldPaths: ['order'] },
        updateTransforms: [{ fieldPath: 'at', setToServerValue: 'REQUEST_TIME' }],
        currentDocument: { exists: false }
      });
    }

    return commit(writes, who);
  }

  /* The proof goes where the buyer can see it and everything else goes where
     only the shop can. The id says which: a proof is "0-proof-2", a print file
     is "0-print-0", a photograph is "0-wrap-photo-0". The rule on the public
     collection refuses anything that is not a proof, so a mistake here is
     refused rather than quietly leaking somebody's photograph. */
  function collectionFor(id) {
    return /-proof-[0-9]+$/.test(id) ? 'assets' : 'print';
  }

  function writeChunks(number, assets, who) {
    var writes = assets.map(function (a) {
      return {
        update: {
          name: docPath('orders/' + number + '/' + collectionFor(a.id) + '/' + a.id),
          fields: fieldsOf({ i: a.i, data: a.data })
        },
        updateMask: { fieldPaths: ['i', 'data'] },
        currentDocument: { exists: false }
      };
    });

    var run = Promise.resolve();
    for (var at = 0; at < writes.length; at += CHUNKS_PER_COMMIT) {
      (function (slice) {
        run = run.then(function () { return commit(slice, who); });
      })(writes.slice(at, at + CHUNKS_PER_COMMIT));
    }
    return run;
  }

  /* ------------------------------------------------------------------ public

     Takes the order exactly as the checkout assembled it, plus a list of
     { id, dataUrl } images to store beside it. Resolves with the order number
     and whether every chunk landed. */

  Order.create = function (order, images, prefix) {
    var assets = [];
    (images || []).forEach(function (img) {
      chunk(String(img.dataUrl || '')).forEach(function (part, i) {
        assets.push({ id: img.id + '-' + i, i: i, data: part });
      });
    });

    var number = null;
    var attempt = 0;
    var who = null;

    function tryOnce() {
      number = orderNumber(prefix || 'GFT');
      order.orderNumber = number;
      return createOrder(number, order, who).catch(function (err) {
        /* A collision on the number is the only thing worth another go. A
           refusal is a refusal and retrying it five more times helps nobody. */
        var clash = err.status === 409 || /ALREADY_EXISTS|already exists/i.test(err.message || '');
        if (clash && ++attempt < 6) return tryOnce();
        throw err;
      });
    }

    /* A fresh identity, not the page's cached one, so this order's throttle
       document is spent on this order and nothing else.

       No catch. A write with no identity is refused by the rules, and a buyer
       told "something no longer matches our prices" when the real answer is
       that sign in is switched off would be the v0.3.0 mistake again in a new
       place. Let it throw, so the checkout says the system is at fault, which
       it is. */
    return G.Auth.anon(true)
      .then(function (got) {
        who = got;
        order.uid = (got && got.uid) || null;
        return tryOnce();
      })
      .then(function () {
        /* The order has landed. From here the buyer is on the list even if an
           image never finishes, which is why this failure is reported rather
           than thrown. */
        return writeChunks(number, assets, who)
          .then(function () { return { orderNumber: number, assetsComplete: true }; })
          .catch(function () { return { orderNumber: number, assetsComplete: false }; });
      });
  };

  /* Read an order's PROOFS back and reassemble them, for the tracking page.
     Only proofs live in this collection; the print file and the buyer's own
     photograph are next door in print, where the rules let nobody but the shop
     look. The admin has its own reader that fetches both. */
  Order.assets = function (number) {
    var url = G.Data.base + '/orders/' + encodeURIComponent(number) + '/assets' +
              (key ? '?key=' + encodeURIComponent(key) : '');
    return G.Auth.anon()
      .catch(function () { return null; })
      .then(function (who) {
        return fetch(url, withAuth(who, { cache: 'no-store' }));
      })
      .then(function (res) {
        if (!res.ok) throw new Error('assets returned ' + res.status);
        return res.json();
      })
      .then(function (body) {
        var byName = {};
        (body.documents || []).forEach(function (doc) {
          var d = G.Data.decodeDoc(doc);
          if (!d) return;
          /* "0-proof-2" is chunk 2 of the proof on line 0. */
          var cut = d.id.lastIndexOf('-');
          var name = d.id.slice(0, cut);
          (byName[name] = byName[name] || [])[d.i] = d.data;
        });
        var out = {};
        Object.keys(byName).forEach(function (name) {
          var parts = byName[name];
          /* A hole means a chunk never landed. Half an image is not an image,
             so it is reported missing rather than drawn as garbage. */
          for (var i = 0; i < parts.length; i++) if (parts[i] == null) return;
          out[name] = parts.join('');
        });
        return out;
      });
  };

})(window.Gifty = window.Gifty || {});
