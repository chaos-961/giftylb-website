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
    /* Five digits. The tracking link needs no login by design, so the number is
       the only thing standing between a stranger and someone else's order. */
    return prefix + '-' + (10000 + Math.floor(Math.random() * 90000));
  }

  function commit(writes) {
    return fetch(commitUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ writes: writes })
    }).then(function (res) {
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
  function createOrder(number, data) {
    return commit([{
      update: { name: docPath('orders/' + number), fields: fieldsOf(data) },
      updateMask: { fieldPaths: Object.keys(data) },
      updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
      currentDocument: { exists: false }
    }]);
  }

  function writeChunks(number, assets) {
    var writes = assets.map(function (a) {
      return {
        update: {
          name: docPath('orders/' + number + '/assets/' + a.id),
          fields: fieldsOf({ i: a.i, data: a.data })
        },
        updateMask: { fieldPaths: ['i', 'data'] },
        currentDocument: { exists: false }
      };
    });

    var run = Promise.resolve();
    for (var at = 0; at < writes.length; at += CHUNKS_PER_COMMIT) {
      (function (slice) {
        run = run.then(function () { return commit(slice); });
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

    function tryOnce() {
      number = orderNumber(prefix || 'GFT');
      order.orderNumber = number;
      return createOrder(number, order).catch(function (err) {
        /* A collision on the number is the only thing worth another go. A
           refusal is a refusal and retrying it five more times helps nobody. */
        var clash = err.status === 409 || /ALREADY_EXISTS|already exists/i.test(err.message || '');
        if (clash && ++attempt < 6) return tryOnce();
        throw err;
      });
    }

    return tryOnce()
      .then(function () {
        /* The order has landed. From here the buyer is on the list even if an
           image never finishes, which is why this failure is reported rather
           than thrown. */
        return writeChunks(number, assets)
          .then(function () { return { orderNumber: number, assetsComplete: true }; })
          .catch(function () { return { orderNumber: number, assetsComplete: false }; });
      });
  };

  /* Read an order's images back and reassemble them. Used by the tracking page
     and by the admin, both of which want the picture, not the chunks. */
  Order.assets = function (number) {
    var url = G.Data.base + '/orders/' + encodeURIComponent(number) + '/assets' +
              (key ? '?key=' + encodeURIComponent(key) : '');
    return fetch(url, { cache: 'no-store' })
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
