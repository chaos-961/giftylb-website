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
  var busy = false;

  /* The order goes straight to the database, so all ordering needs is a
     configured project. There is nothing left to switch on separately. */
  var READY = !!(window.GIFTY_CONFIG && window.GIFTY_CONFIG.projectId);

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
      /* Not "!READY ||". A flag that says a thing is not configured has to gate
         with &&: written "!READY || ..." it reads as "only required when on"
         and means "never required", which is how a buyer once got all the way
         to a network error after typing out their address. */
      && READY;
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
    var zone = G.Delivery.zone(G.Cart.zone() || settings.defaultZone);
    var when = G.Delivery.promise(G.Cart.leadTimeDays(), zone.id);

    /* Every image the order carries, built here and not a moment earlier,
       because until the buyer has said the design is right none of it is worth
       keeping. They are stored beside the order rather than at an image host:
       see js/order.js for why the database is the right place for them. */
    var images = [];
    var lines = [];

    G.Design.ready()
      .then(function () {
        items.forEach(function (it, i) {
          images.push({ id: i + '-proof', dataUrl: G.Proof.proof(it.recipe, it.cache, it.images, it.state) });

          var print = G.Proof.printFile(it.recipe, it.state);
          if (print) images.push({ id: i + '-print', dataUrl: print });

          /* The buyer's own photo is the one thing here that cannot be drawn
             again from the saved design, so it is kept at print size. */
          Object.keys(it.state.zones || {}).forEach(function (zid) {
            var photo = it.state.zones[zid].photo;
            if (photo && photo.image) {
              images.push({ id: i + '-' + zid + '-photo', dataUrl: G.Order.shrink(photo.image) });
            }
          });

          lines.push({
            productId: it.cart.productId,
            productName: it.recipe.name,
            boxId: it.cart.boxId || null,
            qty: it.cart.qty,
            unitPrice: it.cart.unitPrice,
            leadTimeDays: it.recipe.leadTimeDays || 1,
            config: forWire(it.state),
            summary: said(it.state)
          });
        });

        $('place').textContent = 'Placing the order';

        var subtotal = Math.round(G.Cart.subtotal() * 100) / 100;
        var discount = Math.round(G.Cart.discount(settings) * 100) / 100;

        var order = {
          orderNumber: '',
          status: 'new',
          buyer: { name: v.name, phone: v.phone, email: v.email || null },
          delivery: {
            zone: zone.id,
            zoneName: zone.name,
            address: v.address,
            fee: zone.fee,
            promisedDate: when.label
          },
          items: lines,
          totals: {
            subtotal: subtotal,
            delivery: zone.fee,
            discount: discount,
            total: orderTotal(zone)
          },
          payment: { method: payment.id, reference: v.reference || null },
          notes: v.notes || null,
          statusHistory: [{ status: 'new', at: new Date().toISOString(), by: 'buyer' }]
        };

        return G.Order.create(order, images, settings.orderPrefix || 'GFT')
          .then(function (r) { return { order: order, result: r, when: when }; });
      })
      .then(function (done) {
        succeed(done);
      })
      .catch(function (err) {
        /* A refused write is almost always the price bound in the rules, which
           means the catalogue moved while they were designing. Everything else
           is the system's fault and says so. */
        var denied = /PERMISSION_DENIED|permission/i.test((err && err.message) || '');
        fail(denied
          ? 'Something on this order no longer matches our prices. Please open the cart, check it over and try again.'
          : 'We could not save your order just now. Nothing has been charged. Please try again in a moment.');
        if (window.console) console.error(err);
      });
  }

  function said(state) {
    var words = Object.keys(state.zones || {})
      .map(function (id) { return ((state.zones[id].text || {}).value || '').trim(); })
      .filter(Boolean);
    return words.length ? words.join(' / ') : 'No text';
  }

  /* The design travels as its numbers, never as a bitmap. The photo itself is
     an asset beside the order, found by name, so this carries the crop that
     rebuilt it and nothing heavier. */
  function forWire(state) {
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
          natW: z.photo.natW, natH: z.photo.natH,
          k: z.photo.k, ox: z.photo.ox, oy: z.photo.oy
        } : null
      };
    });
    return out;
  }

  function succeed(done) {
    G.Cart.clear();
    $('flow').hidden = true;
    $('done').hidden = false;
    $('doneNumber').textContent = done.result.orderNumber;
    $('doneDate').textContent = done.when.label;
    $('doneTrack').href = 'track.html#' + done.result.orderNumber;
    /* No email is sent by anything any more, so the number on this screen is
       genuinely the only copy the buyer gets. Say so rather than promising an
       inbox nothing writes to. */
    $('doneNote').textContent = done.result.assetsComplete
      ? 'Write the order number down. It is how you follow the order, and we have your design.'
      : 'Write the order number down. Part of your picture did not finish uploading, so we may message you to send it again.';
    window.scrollTo(0, 0);
  }

  /* ---------------------------------------------------------------- not on */

  function armOrdering() {
    if (READY) return;
    $('offNotice').hidden = false;
    /* The button never comes alive in this state, so it has to say why by
       itself. A dead button labelled "Place the order" reads as broken. */
    $('place').textContent = 'Ordering is not switched on yet';
    $('goNote').textContent = 'Ordering switches on shortly. Your cart is kept on this phone until then.';
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
        armOrdering();

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
