/* Gifty. The proof, then the order.
 *
 * The anxiety this screen exists for is "will it actually look right". So the
 * first thing on it is the thing itself, rendered from the design the buyer
 * saved, and nothing can be ordered until they have said that picture is right.
 * That same picture is what goes on the order, in the email, and in the admin.
 *
 * Prices shown here are the client's opinion. The server has the last word, and
 * when it disagrees the buyer is shown what changed rather than a refusal.
 */
(function (G) {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var settings = null;
  var items = [];              /* cart items, with recipe, images, cache, state */
  var payment = null;
  var turnstileToken = null;
  var busy = false;

  /* Ordering needs a bot check and somewhere to send the order. Until both are
     configured the screen still renders the proof, because seeing the proof is
     useful on its own, and says plainly that ordering is not on yet. */
  var READY = !!(window.GIFTY_API && window.GIFTY_CONFIG && window.GIFTY_CONFIG.turnstileSiteKey);

  /* ------------------------------------------------------------------ proof */

  function loadItem(item) {
    return G.Recipe.load(item.productId)
      .then(function (recipe) {
        return G.Recipe.loadImages(recipe).then(function (images) {
          return { recipe: recipe, images: images };
        });
      })
      .then(function (loaded) {
        return G.State.hydrate(item.snapshot).then(function (state) {
          return {
            cart: item,
            recipe: loaded.recipe,
            images: loaded.images,
            cache: G.Render.prepare(loaded.recipe, loaded.images),
            state: state
          };
        });
      });
  }

  function paintProofs() {
    var list = $('proofs');
    list.textContent = '';

    items.forEach(function (it, i) {
      var li = document.createElement('li');
      li.className = 'proof';

      var art = document.createElement('div');
      art.className = 'proof__art is-arriving';
      /* One after another rather than all at once, so a cart of three reads as
         three things being unwrapped and not as one flicker. */
      art.style.setProperty('--proof-delay', (i * 110) + 'ms');
      var canvas = document.createElement('canvas');
      var view = it.recipe.views[0];
      canvas.width = 720;
      canvas.height = Math.round(720 * view.h / view.w);
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', 'Your ' + it.recipe.name.toLowerCase() + ', exactly as it will print');
      art.appendChild(canvas);

      var scratch = document.createElement('canvas');
      G.Render.draw(scratch, it.recipe, it.cache, it.images, it.state, 1);
      canvas.getContext('2d').drawImage(scratch, 0, 0, canvas.width, canvas.height);

      var body = document.createElement('div');
      body.className = 'proof__body';

      var name = document.createElement('p');
      name.className = 'proof__name';
      name.textContent = it.recipe.name + (it.cart.qty > 1 ? ' x' + it.cart.qty : '');

      var words = document.createElement('p');
      words.className = 'proof__words';
      var said = Object.keys(it.state.zones)
        .map(function (id) { return (it.state.zones[id].text || {}).value || ''; })
        .filter(function (v) { return v.trim(); });
      words.textContent = said.length ? said.join(' / ') : 'No words on this one';

      var edit = document.createElement('a');
      edit.className = 'linkbtn';
      edit.href = 'customize.html?p=' + encodeURIComponent(it.cart.productId) + '&c=' + encodeURIComponent(it.cart.id);
      edit.textContent = 'Change it';

      body.appendChild(name);
      body.appendChild(words);
      body.appendChild(edit);
      li.appendChild(art);
      li.appendChild(body);
      list.appendChild(li);
    });
  }

  /* ----------------------------------------------------------------- totals */

  function paintTotals() {
    var zoneId = G.Cart.zone() || settings.defaultZone;
    var zone = G.Delivery.zone(zoneId);
    var subtotal = G.Cart.subtotal();
    var saving = G.Cart.discount(settings);
    var money = function (n) { return G.Price.format(n, settings.currency); };

    var list = $('sideItems');
    list.textContent = '';
    items.forEach(function (it) {
      var li = document.createElement('li');
      var a = document.createElement('span');
      a.textContent = it.recipe.name + (it.cart.qty > 1 ? ' x' + it.cart.qty : '');
      var b = document.createElement('span');
      b.textContent = money(it.cart.unitPrice * it.cart.qty);
      li.appendChild(a); li.appendChild(b);
      list.appendChild(li);
    });

    $('sumItems').textContent = money(subtotal);
    $('sumSaving').textContent = '-' + money(saving);
    $('sumSavingRow').hidden = saving <= 0;
    $('sumDelivery').textContent = money(zone.fee);
    $('sumTotal').textContent = money(orderTotal(zone));
    $('zoneHint').textContent = zone.area + '. Delivery ' + money(zone.fee) + '.';
    $('sumPromise').textContent =
      G.Delivery.sentence(G.Delivery.promise(G.Cart.leadTimeDays(), zoneId));
  }

  /* The one figure the whole screen agrees on, so the panel, the button and
     the request can never quote three different numbers. */
  function orderTotal(zone) {
    return Math.round((G.Cart.subtotal() + zone.fee - G.Cart.discount(settings)) * 100) / 100;
  }

  /* ------------------------------------------------------------------ form */

  function buildZone() {
    var wrap = $('zoneWrap');
    wrap.textContent = '';
    var sel = G.Delivery.zoneSelect('zone', G.Cart.zone(), function (id) {
      G.Cart.setZone(id).then(paintTotals);
    });
    wrap.appendChild(sel);
  }

  function buildPayments() {
    var box = $('pays');
    box.textContent = '';
    (settings.payments || []).forEach(function (p, i) {
      var label = document.createElement('label');
      label.className = 'pay';

      var input = document.createElement('input');
      input.type = 'radio';
      input.name = 'pay';
      input.value = p.id;
      if (i === 0) { input.checked = true; payment = p; }

      var text = document.createElement('span');
      var strong = document.createElement('strong');
      strong.textContent = p.name;
      var blurb = document.createElement('span');
      blurb.className = 'pay__blurb';
      blurb.textContent = p.blurb;
      text.appendChild(strong);
      text.appendChild(blurb);

      input.addEventListener('change', function () {
        payment = p;
        $('refField').hidden = !p.needsReference;
        validate();
      });

      label.appendChild(input);
      label.appendChild(text);
      box.appendChild(label);
    });
    $('refField').hidden = !(payment && payment.needsReference);
  }

  function values() {
    return {
      name: $('name').value.trim(),
      phone: $('phone').value.trim(),
      email: $('email').value.trim(),
      address: $('address').value.trim(),
      reference: $('reference').value.trim(),
      notes: $('notes').value.trim()
    };
  }

  function validate() {
    if (busy) return false;
    var v = values();
    var ok = $('approve').checked
      && v.name.length >= 2
      && v.phone.length >= 6
      && v.address.length >= 5
      && !!payment
      && (!payment.needsReference || v.reference.length >= 3)
      && (!READY || !!turnstileToken);
    $('place').disabled = !ok;
    return ok;
  }

  /* ------------------------------------------------------------------ order */

  function fail(message) {
    busy = false;
    $('formError').hidden = false;
    $('formError').textContent = message;
    $('place').textContent = 'Place the order';
    validate();
  }

  function place() {
    if (!validate()) return;
    busy = true;
    $('formError').hidden = true;
    $('place').disabled = true;
    $('place').textContent = 'Making your proof';

    var v = values();

    /* The proof and the print file are only worth keeping once the buyer has
       said the design is right, so they are built and uploaded here and not a
       moment earlier. */
    var uploads = items.map(function (it) {
      return G.Design.ready()
        .then(function () { return uploadPhotos(it); })
        .then(function (photoUrls) {
          var proof = G.Proof.proof(it.recipe, it.cache, it.images, it.state);
          var print = G.Proof.printFile(it.recipe, it.state);
          return G.Proof.upload(proof, it.recipe.id + '-proof', turnstileToken)
            .then(function (proofUrl) {
              if (!print) return { proofUrl: proofUrl, printFileUrl: '' };
              return G.Proof.upload(print, it.recipe.id + '-print', turnstileToken)
                .then(function (printUrl) { return { proofUrl: proofUrl, printFileUrl: printUrl }; });
            })
            .then(function (urls) {
              return {
                productId: it.cart.productId,
                boxId: it.cart.boxId || null,
                qty: it.cart.qty,
                unitPrice: it.cart.unitPrice,
                config: forWire(it.state, photoUrls),
                proofUrl: urls.proofUrl,
                printFileUrl: urls.printFileUrl
              };
            });
        });
    });

    Promise.all(uploads)
      .then(function (wireItems) {
        $('place').textContent = 'Placing the order';
        var zone = G.Delivery.zone(G.Cart.zone() || settings.defaultZone);
        return fetch(window.GIFTY_API + '/api/order', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token: turnstileToken,
            buyer: { name: v.name, phone: v.phone, email: v.email || null },
            delivery: { zone: zone.id, address: v.address },
            payment: { method: payment.id, reference: v.reference || null },
            notes: v.notes || null,
            items: wireItems,
            totals: { total: orderTotal(zone) }
          })
        });
      })
      .then(function (res) {
        return res.json().then(function (body) { return { status: res.status, body: body }; });
      })
      .then(function (r) {
        if (r.status === 409) {
          /* The catalogue moved while they were designing. Show the new figure
             rather than refusing and leaving them to guess. */
          reprice(r.body);
          return;
        }
        if (r.status !== 200) {
          fail(r.body.message || 'We could not place that just now. Please try again in a moment.');
          return;
        }
        succeed(r.body);
      })
      .catch(function () {
        fail('We could not reach the order desk just now. Nothing has been charged. Please try again, or send us a message and we will place it for you.');
      });
  }

  /* The buyer's own photo goes up alongside the proof and the print file. The
     print file is what the press needs, but without the original the shop can
     never re-crop or reprint at another size without asking the buyer for the
     picture again. One upload per photo, once, at order time. */
  function uploadPhotos(it) {
    var jobs = [];
    var urls = {};
    Object.keys(it.state.zones || {}).forEach(function (id) {
      var photo = it.state.zones[id].photo;
      if (!photo || !photo.saveSrc) return;
      jobs.push(
        G.Proof.upload(photo.saveSrc, it.recipe.id + '-' + id + '-photo', turnstileToken)
          .then(function (url) { urls[id] = url; })
      );
    });
    return Promise.all(jobs).then(function () { return urls; });
  }

  /* The database keeps no bitmaps. The design travels as the photo's URL plus
     its crop, which is everything the print file was built from and everything
     the shop needs to rebuild it. */
  function forWire(state, photoUrls) {
    var out = { productId: state.productId, colors: {}, zones: {} };
    Object.keys(state.colors || {}).forEach(function (k) { out.colors[k] = state.colors[k]; });
    Object.keys(state.zones || {}).forEach(function (id) {
      var z = state.zones[id];
      out.zones[id] = {
        text: z.text ? {
          value: z.text.value, font: z.text.font, color: z.text.color,
          size: z.text.size, y: z.text.y
        } : null,
        photo: z.photo ? {
          url: (photoUrls && photoUrls[id]) || z.photo.url || '',
          natW: z.photo.natW, natH: z.photo.natH,
          k: z.photo.k, ox: z.photo.ox, oy: z.photo.oy
        } : null
      };
    });
    return out;
  }

  function reprice(body) {
    busy = false;
    $('place').textContent = 'Place the order';
    if (body.productId) {
      var it = items.filter(function (x) { return x.cart.productId === body.productId; })[0];
      if (it) {
        it.cart.unitPrice = body.now;
        G.Cart.replace(it.cart.id, it.cart);
      }
    }
    paintTotals();
    fail(body.message + ' Check the total and place it again.');
  }

  function succeed(body) {
    G.Cart.clear();
    $('flow').hidden = true;
    $('done').hidden = false;
    $('doneNumber').textContent = body.orderNumber;
    $('doneDate').textContent = body.promisedDate;
    $('doneTrack').href = 'track.html#' + body.orderNumber;
    $('doneNote').textContent = values().email
      ? 'We have emailed you the proof and this order number.'
      : 'Write the order number down. It is how you follow the order.';
    window.scrollTo(0, 0);
  }

  /* -------------------------------------------------------------- turnstile */

  function armTurnstile() {
    if (!READY) {
      $('offNotice').hidden = false;
      $('goNote').textContent = 'Ordering switches on shortly. Your cart is kept on this phone until then.';
      return;
    }
    window.onTurnstileReady = function () {
      window.turnstile.render('#turnstile', {
        sitekey: window.GIFTY_CONFIG.turnstileSiteKey,
        callback: function (token) { turnstileToken = token; validate(); },
        'expired-callback': function () { turnstileToken = null; validate(); },
        'error-callback': function () { turnstileToken = null; validate(); }
      });
    };
    var s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileReady';
    s.async = true;
    s.defer = true;
    document.head.appendChild(s);
  }

  /* ------------------------------------------------------------------- boot */

  function boot() {
    var cart = G.Cart.items();
    if (!cart.length) {
      $('empty').hidden = false;
      return;
    }

    G.Delivery.load()
      .then(function (s) {
        settings = s;
        if (cart.length > (s.maxCartItems || 6)) {
          throw new Error('An order can hold ' + (s.maxCartItems || 6) + ' things.');
        }
        /* Every face the renderer can draw, before anything is drawn. The
           proof is what the buyer approves, so it cannot be in a fallback. */
        return Promise.all([G.Design.ready()].concat(cart.map(loadItem)));
      })
      .then(function (loaded) {
        items = loaded.slice(1);
        $('checkout').hidden = false;
        paintProofs();
        buildZone();
        buildPayments();
        paintTotals();
        armTurnstile();

        ['approve', 'name', 'phone', 'email', 'address', 'reference'].forEach(function (id) {
          $(id).addEventListener('input', validate);
          $(id).addEventListener('change', validate);
        });
        $('place').addEventListener('click', place);
        validate();
      })
      .catch(function (err) {
        $('fatal').hidden = false;
        $('fatal').textContent = (err && err.message && err.message.indexOf('An order can hold') === 0)
          ? err.message + ' Please take one out and come back.'
          : 'We could not open your proof just now. That one is on us. Please try again in a moment.';
        if (window.console) console.error(err);
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})(window.Gifty = window.Gifty || {});
