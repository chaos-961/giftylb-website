/* Gifty. The cart screen.
 *
 * Reads the store, paints it, and writes back. No product knowledge and no
 * drawing: every item already carries the thumbnail the buyer approved in the
 * customizer, so this screen never has to re-render a design to show one.
 */
(function (G) {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var settings = null;

  function money(n) { return G.Price.format(n, settings ? settings.currency : 'USD'); }

  /* --------------------------------------------------------------- one item */

  function itemRow(item, opts) {
    opts = opts || {};
    var li = document.createElement('li');
    li.className = 'cart-item';

    var art = document.createElement('div');
    art.className = 'cart-item__art';
    if (item.thumb) {
      var img = document.createElement('img');
      img.src = item.thumb;
      /* Not lazy. The thumbnail is a data URL that is already in memory, so
         deferring it saves no network and only delays the paint. */
      img.alt = 'Your ' + item.productName.toLowerCase() + ' design';
      art.appendChild(img);
    }

    var body = document.createElement('div');
    body.className = 'cart-item__body';

    var name = document.createElement('p');
    name.className = 'cart-item__name';
    name.textContent = item.productName;

    /* Two mugs in a cart look identical unless the words are on the row, so the
       design's own text comes first and the price breakdown only fills in when
       there is nothing to quote. */
    var words = Object.keys((item.snapshot && item.snapshot.zones) || {})
      .map(function (id) { return (item.snapshot.zones[id].text || {}).value || ''; })
      .filter(function (v) { return v.trim(); });

    var lines = document.createElement('p');
    lines.className = 'cart-item__lines';
    lines.textContent = words.length
      ? words.join(' / ')
      : ((item.lines || []).slice(1).map(function (l) { return l.label; }).join(', ') || 'Plain, no extras');

    var price = document.createElement('p');
    price.className = 'cart-item__price';
    price.textContent = money(item.unitPrice * item.qty) +
      (item.qty > 1 ? ' (' + money(item.unitPrice) + ' each)' : '');

    var actions = document.createElement('div');
    actions.className = 'cart-item__actions';

    var qty = document.createElement('div');
    qty.className = 'qty';
    var minus = document.createElement('button');
    minus.type = 'button';
    minus.textContent = '−';
    minus.setAttribute('aria-label', 'One fewer ' + item.productName.toLowerCase());
    minus.disabled = item.qty <= 1;
    var out = document.createElement('output');
    out.textContent = String(item.qty);
    out.setAttribute('aria-live', 'polite');
    var plus = document.createElement('button');
    plus.type = 'button';
    plus.textContent = '+';
    plus.setAttribute('aria-label', 'One more ' + item.productName.toLowerCase());
    minus.addEventListener('click', function () { G.Cart.setQty(item.id, item.qty - 1).then(paint); });
    plus.addEventListener('click', function () { G.Cart.setQty(item.id, item.qty + 1).then(paint); });
    qty.appendChild(minus); qty.appendChild(out); qty.appendChild(plus);

    var edit = document.createElement('a');
    edit.className = 'linkbtn';
    edit.href = 'customize.html?p=' + encodeURIComponent(item.productId) + '&c=' + encodeURIComponent(item.id);
    edit.textContent = 'Edit';

    var remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'linkbtn linkbtn--danger';
    remove.textContent = 'Remove';
    remove.addEventListener('click', function () {
      G.Cart.remove(item.id, settings).then(function (out) {
        notice(out.unwrapped
          ? 'That box needed at least ' + G.Bundle.config(settings).minItems +
            ' things in it, so we took it apart. Everything else is still here.'
          : '');
        paint();
      });
    });

    if (!opts.noQty) actions.appendChild(qty);
    actions.appendChild(edit);
    actions.appendChild(remove);

    body.appendChild(name);
    body.appendChild(lines);
    body.appendChild(price);
    body.appendChild(actions);
    li.appendChild(art);
    li.appendChild(body);
    return li;
  }

  /* -------------------------------------------------------------- the box

     A box is drawn as what it is: the ribbon and the card at the top, the
     things it holds indented under it, and the saving stated in figures rather
     than promised in words. */

  function boxBlock(group) {
    var cfg = G.Bundle.config(settings);
    var li = document.createElement('li');
    li.className = 'cart-box';

    var head = document.createElement('div');
    head.className = 'cart-box__head';
    head.appendChild(itemRow(group.box, { noQty: true }));

    var inner = document.createElement('ul');
    inner.className = 'cart-box__items';
    inner.setAttribute('role', 'list');
    group.items.forEach(function (item) { inner.appendChild(itemRow(item)); });

    var foot = document.createElement('p');
    foot.className = 'cart-box__saving';
    foot.textContent = 'Boxed together, you save ' +
      money(G.Bundle.saving(cfg.discountPercent, group.items)) + '.';

    var actions = document.createElement('div');
    actions.className = 'cart-box__actions';
    var undo = document.createElement('button');
    undo.type = 'button';
    undo.className = 'linkbtn';
    undo.textContent = 'Take it out of the box';
    undo.addEventListener('click', function () {
      G.Cart.unwrap(group.id, settings).then(function () {
        notice('Unwrapped. Everything is still in the cart on its own.');
        paint();
      });
    });
    actions.appendChild(undo);

    li.appendChild(head);
    li.appendChild(inner);
    li.appendChild(foot);
    li.appendChild(actions);
    return li;
  }

  function notice(text) {
    var box = $('cartNotice');
    box.hidden = !text;
    box.textContent = text || '';
  }

  function paintBoxCta() {
    var cfg = G.Bundle.config(settings);
    var free = G.Cart.wrappable().length;
    var cta = $('cartBoxCta');
    cta.hidden = free < cfg.minItems;
    if (cta.hidden) return;
    $('boxCtaSub').textContent =
      'Wrap ' + cfg.minItems + ' to ' + cfg.maxItems + ' of them with a ribbon and a card, and take ' +
      cfg.discountPercent + '% off what is inside.';
  }

  /* ----------------------------------------------------------------- totals */

  function paintSide() {
    var zoneId = G.Cart.zone() || settings.defaultZone;
    var zone = G.Delivery.zone(zoneId);
    var subtotal = G.Cart.subtotal();
    var saving = G.Cart.discount(settings);

    $('zoneArea').textContent = zone.area + '.';

    $('totalItems').textContent = money(subtotal);
    $('totalSaving').textContent = '-' + money(saving);
    $('totalSavingRow').hidden = saving <= 0;
    $('totalDelivery').textContent = money(zone.fee);
    $('totalGrand').textContent = money(Math.round((subtotal + zone.fee - saving) * 100) / 100);
    if ($('barTotal')) $('barTotal').textContent = $('totalGrand').textContent;

    var promise = G.Delivery.promise(G.Cart.leadTimeDays(), zoneId);
    $('cartPromise').textContent = G.Delivery.sentence(promise);
  }

  function buildZoneSwitch() {
    var box = $('cartZone');
    box.textContent = '';
    box.appendChild(G.Delivery.zoneSelect('cartZoneSelect', G.Cart.zone(), function (id) {
      G.Cart.setZone(id).then(paintSide);
    }));
  }

  /* ------------------------------------------------------------------ paint */

  function paint() {
    var items = G.Cart.items();
    $('cartEmpty').hidden = items.length > 0;
    $('cartLayout').hidden = items.length === 0;
    $('cartCount').textContent = !items.length ? 'Nothing in the cart yet.'
      : items.length === 1 ? 'One thing in the cart'
      : items.length + ' things in the cart';
    if (!items.length) return;

    var cfg = G.Bundle.config(settings);
    var list = $('cartList');
    list.textContent = '';

    var boxed = {};
    G.Cart.boxes(settings).forEach(function (group) {
      if (!G.Bundle.complete(group, cfg)) return;
      list.appendChild(boxBlock(group));
      boxed[group.box.id] = 1;
      group.items.forEach(function (i) { boxed[i.id] = 1; });
    });

    items.forEach(function (item) {
      if (boxed[item.id]) return;
      list.appendChild(itemRow(item));
    });

    paintBoxCta();
    paintSide();
  }

  function boot() {
    G.Delivery.load()
      .then(function (s) {
        settings = s;
        buildZoneSwitch();
        paint();
        setInterval(function () { if (G.Cart.count()) paintSide(); }, 30000);
      })
      .catch(function (err) {
        $('cartError').hidden = false;
        if (window.console) console.error(err);
      });

    /* Another tab emptied it, or added to it. Repaint rather than lie. */
    G.Cart.subscribe(function () { if (settings) paint(); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})(window.Gifty = window.Gifty || {});
