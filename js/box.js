/* Gifty. The gift box builder.
 *
 * A box is not a new kind of product. It is two to four things the buyer has
 * already made, plus one gift-box item carrying the ribbon and the card, all
 * sharing a boxId. So this screen writes no new price rule and no new order
 * shape: it ties existing cart items together and adds one more of them.
 *
 * The box itself is drawn by the same engine as every other product, from the
 * gift-box recipe. There is no drawing code in this file.
 */
(function (G) {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var settings = null, cfg = null;
  var recipe = null, images = null, cache = null;
  var state = null;
  var rule = null, zone = null;
  var candidates = [];
  var chosen = {};
  var frame = null;
  var busy = false;

  function money(n) { return G.Price.format(n, settings ? settings.currency : 'USD'); }

  function chosenItems() {
    return candidates.filter(function (i) { return chosen[i.id]; });
  }

  /* ------------------------------------------------------------- rendering */

  function schedule() {
    if (frame) return;
    frame = requestAnimationFrame(function () {
      frame = null;
      G.Render.draw($('boxPreview'), recipe, cache, images, state, 1);
    });
  }

  /* ----------------------------------------------------------------- price */

  function paintPrice() {
    var picked = chosenItems();
    var things = G.Bundle.gross(picked);
    var box = G.Price.compute(recipe, state).total;
    var ok = picked.length >= cfg.minItems && picked.length <= cfg.maxItems;
    var saving = ok ? G.Bundle.saving(cfg.discountPercent, picked) : 0;

    $('sumThingsLabel').textContent = picked.length === 1 ? '1 thing' : picked.length + ' things';
    $('sumThings').textContent = money(things);
    $('sumBox').textContent = money(box);
    $('sumSaving').textContent = '-' + money(saving);
    $('sumSavingRow').hidden = saving <= 0;
    $('sumBoxTotal').textContent = money(Math.round((things + box - saving) * 100) / 100);

    $('boxAdd').disabled = !ok || busy;
    $('boxNote').textContent = !ok
      ? (picked.length < cfg.minItems
          ? 'Tick at least ' + cfg.minItems + ' things and the saving comes off.'
          : cfg.maxItems + ' is the most that fits in one box.')
      : 'You save ' + money(saving) + ' by sending them in one box.';
  }

  /* ------------------------------------------------------------- the picks */

  function paintHint() {
    var n = chosenItems().length;
    $('gbPickHint').textContent = n >= cfg.maxItems
      ? cfg.maxItems + ' is the most that fits. Untick one to swap it.'
      : 'Pick ' + cfg.minItems + ' to ' + cfg.maxItems + ' of them.';

    var full = n >= cfg.maxItems;
    [].forEach.call($('boxPicks').querySelectorAll('input'), function (input) {
      input.disabled = full && !input.checked;
      var row = input.closest('.gb-pick');
      row.classList.toggle('is-off', input.disabled);
      row.classList.toggle('is-on', input.checked);
    });
  }

  function buildPicks() {
    var list = $('boxPicks');
    list.textContent = '';

    candidates.forEach(function (item) {
      var li = document.createElement('li');
      var label = document.createElement('label');
      label.className = 'gb-pick';

      var input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = !!chosen[item.id];
      input.addEventListener('change', function () {
        chosen[item.id] = input.checked;
        paintHint();
        paintPrice();
      });

      var art = document.createElement('span');
      art.className = 'gb-pick__art';
      if (item.thumb) {
        var img = document.createElement('img');
        img.src = item.thumb;
        img.alt = '';
        art.appendChild(img);
      }

      var body = document.createElement('span');
      body.className = 'gb-pick__body';

      var name = document.createElement('span');
      name.className = 'gb-pick__name';
      name.textContent = item.productName + (item.qty > 1 ? ' x' + item.qty : '');

      var words = Object.keys((item.snapshot && item.snapshot.zones) || {})
        .map(function (id) { return (item.snapshot.zones[id].text || {}).value || ''; })
        .filter(function (v) { return v.trim(); });

      var says = document.createElement('span');
      says.className = 'gb-pick__says';
      says.textContent = words.length ? words.join(' / ') : 'No words on this one';

      var price = document.createElement('span');
      price.className = 'gb-pick__price';
      price.textContent = money(item.unitPrice * (item.qty || 1));

      body.appendChild(name);
      body.appendChild(says);
      label.appendChild(input);
      label.appendChild(art);
      label.appendChild(body);
      label.appendChild(price);
      li.appendChild(label);
      list.appendChild(li);
    });
  }

  /* ------------------------------------------------------------- the looks */

  function buildParts() {
    var box = $('boxParts');
    box.textContent = '';

    recipe.colorParts.forEach(function (part) {
      var wrap = document.createElement('div');
      wrap.className = 'gb-part';

      var h = document.createElement('p');
      h.className = 'gb-partname';
      h.textContent = part.name;

      var row = document.createElement('div');
      row.className = 'gb-swatches';
      row.setAttribute('role', 'group');
      row.setAttribute('aria-label', part.name);

      part.palette.forEach(function (c) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'gb-swatch';
        b.style.background = c.hex;
        b.title = c.name;
        b.setAttribute('aria-label', c.name);
        b.setAttribute('aria-pressed',
          String(c.hex.toUpperCase() === String(state.colors[part.id]).toUpperCase()));
        b.addEventListener('click', function () {
          state.colors[part.id] = c.hex;
          [].forEach.call(row.children, function (n) {
            n.setAttribute('aria-pressed', String(n === b));
          });
          schedule();
        });
        row.appendChild(b);
      });

      wrap.appendChild(h);
      wrap.appendChild(row);
      box.appendChild(wrap);
    });
  }

  /* -------------------------------------------------------------- the card */

  function wireMessage() {
    var input = $('boxMessage');
    input.maxLength = rule.maxChars || 90;
    input.value = state.zones[zone.id].text.value || '';
    $('boxCount').textContent = input.value.length + '/' + input.maxLength;

    input.addEventListener('input', function () {
      var v = G.Design.applyTextRules(rule, input.value);
      state.zones[zone.id].text.value = v;
      $('boxCount').textContent = v.length + '/' + input.maxLength;
      schedule();
    });
  }

  /* --------------------------------------------------------------- wrap it

     The lid comes down over the box. That is the only animation on this screen
     and its job is to confirm: the thing you were looking at is packed, and the
     next screen is the cart. */

  function closeAndGo() {
    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) { location.href = 'cart.html'; return; }
    $('boxStage').classList.add('is-closing');
    setTimeout(function () { location.href = 'cart.html'; }, 620);
  }

  function thumbOf() {
    var view = recipe.views[0];
    var c = document.createElement('canvas');
    c.width = 420;
    c.height = Math.round(420 * view.h / view.w);
    c.getContext('2d').drawImage($('boxPreview'), 0, 0, c.width, c.height);
    try { return c.toDataURL('image/jpeg', 0.82); } catch (e) { return null; }
  }

  function addBox() {
    var picked = chosenItems();
    if (picked.length < cfg.minItems || picked.length > cfg.maxItems) return;

    busy = true;
    $('boxAdd').disabled = true;
    var price = G.Price.compute(recipe, state);

    G.Cart.wrap(picked.map(function (i) { return i.id; }), {
      productId: recipe.id,
      productName: recipe.name,
      leadTimeDays: recipe.leadTimeDays,
      unitPrice: price.total,
      lines: price.lines,
      thumb: thumbOf(),
      snapshot: G.State.snapshot(state)
    }).then(function (boxId) {
      busy = false;
      if (!boxId) {
        $('boxAdd').disabled = false;
        $('boxNote').textContent = 'We could not keep that one. This phone has run out of room for saved designs, so take something out of the cart and try again.';
        return;
      }
      closeAndGo();
    });
  }

  /* ------------------------------------------------------------------- boot */

  function tooFew() {
    var have = candidates.length;
    var need = cfg.minItems - have;
    $('boxEmptyTitle').textContent = have
      ? (need === 1 ? 'One more thing and we can box it.' : need + ' more things and we can box it.')
      : 'You need ' + cfg.minItems + ' things first.';
    $('boxEmptyBody').textContent = have
      ? 'A box holds ' + cfg.minItems + ' to ' + cfg.maxItems + ' of them, with a ribbon and a card.'
      : 'Make a couple of them, then come back and we will wrap them together.';
    $('boxEmpty').hidden = false;
  }

  function boot() {
    G.Delivery.load()
      .then(function (s) {
        settings = s;
        cfg = G.Bundle.config(s);
        candidates = G.Cart.wrappable();
        $('boxLede').textContent =
          cfg.minItems + ' to ' + cfg.maxItems + ' of the things you have made, one ribbon, and ' +
          'a card in your own words. ' + cfg.discountPercent + '% off what is inside.';

        if (candidates.length < cfg.minItems) { tooFew(); return null; }

        return G.Recipe.load(cfg.productId)
          .then(function (r) {
            recipe = r;
            return G.Recipe.loadImages(r);
          })
          .then(function (imgs) {
            images = imgs;
            return G.Design.ready();
          })
          .then(function () {
            cache = G.Render.prepare(recipe, images);
            state = G.Recipe.initialState(recipe);
            zone = recipe.printZones[0];
            rule = (recipe.textRules || []).filter(function (t) { return t.zoneId === zone.id; })[0] || {};

            candidates.slice(0, cfg.maxItems).forEach(function (i) { chosen[i.id] = true; });

            buildPicks();
            buildParts();
            wireMessage();
            paintHint();
            paintPrice();

            $('boxAdd').addEventListener('click', addBox);
            $('boxLayout').hidden = false;

            /* Straight away rather than through requestAnimationFrame, which
               does not fire in a background tab and would leave the box blank
               until the tab was looked at. */
            G.Render.draw($('boxPreview'), recipe, cache, images, state, 1);
          });
      })
      .catch(function (err) {
        $('boxError').hidden = false;
        if (window.console) console.error(err);
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})(window.Gifty = window.Gifty || {});
