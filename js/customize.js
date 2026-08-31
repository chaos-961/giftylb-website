/* Gifty. The customizer screen.
 *
 * This file owns the interface. It owns no drawing and no product knowledge:
 * everything it renders comes out of the recipe, which is why the same screen
 * serves a mug, a cap, a bottle, a tote and a photo block without a branch.
 */
(function (G) {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var recipe = null, images = null, cache = null, store = null;
  var zone = null, rule = null, part0 = null;
  var frame = null, pending = 1, lastTotal = null;

  var el = {};
  ['preview', 'loading', 'productName', 'undoBtn', 'restoredChip', 'startOver', 'dpiChip',
   'photoInput', 'photoBtnLabel', 'removePhoto', 'photoHint', 'photoControls',
   'zoom', 'panX', 'panY', 'recentre', 'textInput', 'charCount', 'fontChips',
   'textColours', 'textColourField', 'textSize', 'textY', 'colourParts',
   'priceAmount', 'priceBreakdown', 'priceBreakdownBtn', 'addBtn', 'dock', 'zonePicker']
    .forEach(function (id) { el[id] = $(id); });

  /* ------------------------------------------------------------- rendering */

  function schedule(step) {
    pending = Math.min(pending, step || 1);
    if (frame) return;
    frame = requestAnimationFrame(function () {
      frame = null;
      var s = pending;
      pending = 1;
      G.Render.draw(el.preview, recipe, cache, images, store.get(), s);
      /* A coarse frame during a drag is followed by a clean one once the
         finger settles, so the preview is never left blocky. */
      if (s > 1) setTimeout(function () { schedule(1); }, 90);
    });
  }

  function onChange(state, meta) {
    schedule(meta && meta.transient ? 2 : 1);
    updatePrice(state);
    updateDpi(state);
    el.undoBtn.disabled = !store.canUndo();
  }

  /* ----------------------------------------------------------------- price */

  function updatePrice(state) {
    var p = G.Price.compute(recipe, state);
    el.priceAmount.textContent = G.Price.format(p.total, p.currency);
    if (lastTotal !== null && lastTotal !== p.total) {
      el.priceAmount.classList.add('is-ticked');
      setTimeout(function () { el.priceAmount.classList.remove('is-ticked'); }, 240);
    }
    lastTotal = p.total;

    el.priceBreakdown.innerHTML = '';
    p.lines.forEach(function (line) {
      var li = document.createElement('li');
      var a = document.createElement('span'); a.textContent = line.label;
      var b = document.createElement('span'); b.textContent = G.Price.format(line.amount, p.currency);
      li.appendChild(a); li.appendChild(b);
      el.priceBreakdown.appendChild(li);
    });
  }

  /* ------------------------------------------------------- resolution gate */

  var cropCanvas = null;

  function updateDpi(state) {
    var photo = state.zones[zone.id].photo;
    if (!photo || !photo.image) { el.dpiChip.hidden = true; return; }

    var check = G.Photo.check(zone, photo);
    if (!check || check.ok) { el.dpiChip.hidden = true; return; }

    el.dpiChip.hidden = false;
    el.dpiChip.textContent = '';

    var text = document.createElement('span');
    text.textContent = 'This will print a little soft at that size. Zoom out a bit, or use a bigger photo.';
    el.dpiChip.appendChild(text);

    /* Show what it will really look like rather than only saying it. The crop
       is drawn at one screen pixel per printed pixel, so the softness on screen
       is the softness on the mug. */
    if (!cropCanvas) {
      cropCanvas = document.createElement('canvas');
      cropCanvas.className = 'cz-crop';
      cropCanvas.width = 132;
      cropCanvas.height = 92;
    }
    el.dpiChip.appendChild(cropCanvas);

    var size = G.Design.sizeFor(zone);
    var cw = cropCanvas.width, ch = cropCanvas.height;
    var ratio = check.dpi / check.min;            /* how far under we are */
    var cx = size.w / 2, cy = size.h / 2;
    var ctx = cropCanvas.getContext('2d');
    ctx.clearRect(0, 0, cw, ch);
    ctx.imageSmoothingEnabled = true;
    var srcW = cw / ratio, srcH = ch / ratio;
    var dw = photo.natW * photo.k, dh = photo.natH * photo.k;
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, cw, ch); ctx.clip();
    ctx.drawImage(
      photo.image,
      0, 0, photo.natW, photo.natH,
      (photo.ox - (cx - srcW / 2)) * (cw / srcW),
      (photo.oy - (cy - srcH / 2)) * (ch / srcH),
      dw * (cw / srcW), dh * (ch / srcH)
    );
    ctx.restore();
  }

  /* ------------------------------------------------------------ photo pane */

  function syncPhotoControls() {
    var photo = store.get().zones[zone.id].photo;
    var has = !!(photo && photo.image);
    el.photoControls.hidden = !has;
    el.removePhoto.hidden = !has;
    el.photoBtnLabel.textContent = has ? 'Use a different photo' : 'Add a photo';
    el.photoHint.textContent = has
      ? 'Drag it on the preview to move it, or use the sliders.'
      : 'Pick a photo from your phone. Drag it on the preview to move it.';
    if (!has) return;

    var size = G.Design.sizeFor(zone);
    var min = G.Design.coverScale(photo, size.w, size.h);
    el.zoom.min = 100;
    el.zoom.max = 400;
    el.zoom.value = Math.round(Math.min(400, Math.max(100, photo.k / min * 100)));

    var dw = photo.natW * photo.k, dh = photo.natH * photo.k;
    var rangeX = size.w - dw, rangeY = size.h - dh;
    el.panX.value = rangeX < 0 ? Math.round(photo.ox / rangeX * 100) : 50;
    el.panY.value = rangeY < 0 ? Math.round(photo.oy / rangeY * 100) : 50;
    el.panX.disabled = rangeX >= 0;
    el.panY.disabled = rangeY >= 0;
  }

  function setPhoto(file) {
    G.Photo.fromFile(file, zone)
      .then(function (photo) {
        store.commit(function (s) { s.zones[zone.id].photo = photo; });
        syncPhotoControls();
      })
      .catch(function (err) {
        el.photoHint.textContent = err.message;
      });
  }

  /* --------------------------------------------------------------- controls */

  function buildFontChips() {
    var fonts = rule.allowedFonts || ['ui'];
    var names = { display: 'Bold', ui: 'Plain', hand: 'Handwritten' };
    fonts.forEach(function (f) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'cz-chipbtn';
      b.dataset.font = f;
      b.textContent = names[f] || f;
      b.setAttribute('aria-pressed', String(store.get().zones[zone.id].text.font === f));
      b.addEventListener('click', function () {
        store.commit(function (s) { s.zones[zone.id].text.font = f; });
        [].forEach.call(el.fontChips.children, function (c) {
          c.setAttribute('aria-pressed', String(c.dataset.font === f));
        });
      });
      el.fontChips.appendChild(b);
    });
  }

  function buildSwatches(container, palette, current, onPick) {
    container.innerHTML = '';
    palette.forEach(function (c) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'cz-swatch';
      b.dataset.hex = c.hex.toUpperCase();
      b.style.background = c.hex;
      b.title = c.name;
      b.setAttribute('aria-label', c.name);
      b.setAttribute('aria-pressed', String(c.hex.toUpperCase() === String(current).toUpperCase()));
      b.addEventListener('click', function () {
        onPick(c.hex);
        [].forEach.call(container.children, function (n) {
          n.setAttribute('aria-pressed', String(n === b));
        });
      });
      container.appendChild(b);
    });
  }

  function markSwatch(container, hex) {
    if (!container) return;
    var want = String(hex || '').toUpperCase();
    [].forEach.call(container.children, function (n) {
      n.setAttribute('aria-pressed', String(n.dataset.hex === want));
    });
  }

  function buildColourParts() {
    el.colourParts.innerHTML = '';
    recipe.colorParts.forEach(function (part) {
      var wrap = document.createElement('div');
      wrap.className = 'cz-part';
      var h = document.createElement('p');
      h.className = 'cz-partname';
      h.textContent = part.name;
      var row = document.createElement('div');
      row.className = 'cz-swatches';
      row.setAttribute('role', 'group');
      row.setAttribute('aria-label', part.name);
      wrap.appendChild(h); wrap.appendChild(row);
      el.colourParts.appendChild(wrap);
      buildSwatches(row, part.palette, store.get().colors[part.id], function (hex) {
        store.commit(function (s) { s.colors[part.id] = hex; });
      });
    });
  }

  /* Switching the active zone re-points every text and photo control at it.
     Products with one zone never see this. The photo block has two, a printed
     acrylic face and an engraved caption, and they take different rules. */
  function applyZone(next) {
    zone = next;
    rule = (recipe.textRules || []).filter(function (t) { return t.zoneId === zone.id; })[0] || {};

    var accepts = zone.accepts || ['photo', 'text'];
    var canPhoto = accepts.indexOf('photo') >= 0;
    var canText = accepts.indexOf('text') >= 0;

    document.getElementById('tab-photo').hidden = !canPhoto;
    document.getElementById('tab-text').hidden = !canText;

    el.textInput.maxLength = rule.maxChars || 40;
    el.fontChips.innerHTML = '';
    buildFontChips();

    if (rule.colorLocked || !rule.palette) {
      el.textColourField.hidden = true;
    } else {
      el.textColourField.hidden = false;
      buildSwatches(el.textColours, rule.palette, store.get().zones[zone.id].text.color, function (hex) {
        store.commit(function (st) { st.zones[zone.id].text.color = hex; });
      });
    }

    /* Land on a tab this zone actually supports. */
    var wanted = canPhoto ? 'tab-photo' : 'tab-text';
    if (document.getElementById(wanted)) document.getElementById(wanted).click();

    [].forEach.call(el.zonePicker.children, function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.zone === zone.id));
    });
    syncAll();
  }

  function buildZonePicker() {
    el.zonePicker.innerHTML = '';
    if (recipe.printZones.length < 2) { el.zonePicker.hidden = true; return; }
    el.zonePicker.hidden = false;
    recipe.printZones.forEach(function (z) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'cz-chipbtn';
      b.dataset.zone = z.id;
      b.textContent = z.name || z.id;
      b.setAttribute('aria-pressed', String(z.id === zone.id));
      b.addEventListener('click', function () { applyZone(z); });
      el.zonePicker.appendChild(b);
    });
  }

  function wireTabs() {
    var tabs = [].slice.call(document.querySelectorAll('.cz-tab'));
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        tabs.forEach(function (t) {
          var on = t === tab;
          t.setAttribute('aria-selected', String(on));
          $(t.getAttribute('aria-controls')).hidden = !on;
        });
      });
    });
  }

  /* ------------------------------------------------------------- canvas drag
     Tracks the finger one to one. Every drag also has a slider, so the whole
     screen is usable without dragging at all. */

  function wireDrag() {
    var dragging = false, lastX = 0, lastY = 0, pointer = null;

    el.preview.addEventListener('pointerdown', function (e) {
      var photo = store.get().zones[zone.id].photo;
      if (!photo || !photo.image) return;
      dragging = true; pointer = e.pointerId;
      lastX = e.clientX; lastY = e.clientY;
      el.preview.setPointerCapture(pointer);
      el.preview.classList.add('is-dragging');
    });

    el.preview.addEventListener('pointermove', function (e) {
      if (!dragging || e.pointerId !== pointer) return;
      var rect = el.preview.getBoundingClientRect();
      var toView = recipe.views[0].w / rect.width;
      var size = G.Design.sizeFor(zone);
      var dx = (e.clientX - lastX) * toView * (size.w / zone.rect.w);
      var dy = (e.clientY - lastY) * toView * (size.h / zone.rect.h);
      lastX = e.clientX; lastY = e.clientY;
      store.touch(function (s) {
        var p = s.zones[zone.id].photo;
        p.ox += dx; p.oy += dy;
        G.Photo.clamp(p, zone);
      });
    });

    function end(e) {
      if (!dragging || (e && e.pointerId !== pointer)) return;
      dragging = false;
      el.preview.classList.remove('is-dragging');
      /* One undo entry for the whole gesture, not one per frame. */
      store.commit(function () {});
      syncPhotoControls();
    }
    el.preview.addEventListener('pointerup', end);
    el.preview.addEventListener('pointercancel', end);
  }

  /* ------------------------------------------------------------------ boot */

  function wire() {
    wireTabs();
    wireDrag();
    buildColourParts();
    buildZonePicker();
    applyZone(zone);

    el.photoInput.addEventListener('change', function (e) {
      if (e.target.files && e.target.files[0]) setPhoto(e.target.files[0]);
      e.target.value = '';
    });

    el.removePhoto.addEventListener('click', function () {
      store.commit(function (s) { s.zones[zone.id].photo = null; });
      syncPhotoControls();
    });

    el.recentre.addEventListener('click', function () {
      store.commit(function (s) { G.Photo.fitCover(s.zones[zone.id].photo, zone); });
      syncPhotoControls();
    });

    el.zoom.addEventListener('input', function () {
      store.touch(function (s) {
        var p = s.zones[zone.id].photo;
        var size = G.Design.sizeFor(zone);
        var min = G.Design.coverScale(p, size.w, size.h);
        var cxd = (size.w / 2 - p.ox) / p.k, cyd = (size.h / 2 - p.oy) / p.k;
        p.k = min * (+el.zoom.value / 100);
        p.ox = size.w / 2 - cxd * p.k;
        p.oy = size.h / 2 - cyd * p.k;
        G.Photo.clamp(p, zone);
      });
    });
    el.zoom.addEventListener('change', function () { store.commit(function () {}); syncPhotoControls(); });

    function panHandler(input, axis) {
      input.addEventListener('input', function () {
        store.touch(function (s) {
          var p = s.zones[zone.id].photo;
          var size = G.Design.sizeFor(zone);
          if (axis === 'x') {
            var rx = size.w - p.natW * p.k;
            if (rx < 0) p.ox = rx * (+input.value / 100);
          } else {
            var ry = size.h - p.natH * p.k;
            if (ry < 0) p.oy = ry * (+input.value / 100);
          }
          G.Photo.clamp(p, zone);
        });
      });
      input.addEventListener('change', function () { store.commit(function () {}); });
    }
    panHandler(el.panX, 'x');
    panHandler(el.panY, 'y');

    el.textInput.addEventListener('input', function () {
      var v = G.Design.applyTextRules(rule, el.textInput.value);
      store.touch(function (s) { s.zones[zone.id].text.value = v; });
      el.charCount.textContent = v.length + '/' + (rule.maxChars || 40);
    });
    el.textInput.addEventListener('change', function () { store.commit(function () {}); });

    el.textSize.addEventListener('input', function () {
      store.touch(function (s) { s.zones[zone.id].text.size = +el.textSize.value / 100; });
    });
    el.textSize.addEventListener('change', function () { store.commit(function () {}); });

    el.textY.addEventListener('input', function () {
      store.touch(function (s) { s.zones[zone.id].text.y = +el.textY.value / 100; });
    });
    el.textY.addEventListener('change', function () { store.commit(function () {}); });

    el.undoBtn.addEventListener('click', function () {
      store.undo().then(function () { syncAll(); });
    });

    document.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        (e.shiftKey ? store.redo() : store.undo()).then(function () { syncAll(); });
      }
    });

    el.priceBreakdownBtn.addEventListener('click', function () {
      var open = el.priceBreakdown.hidden;
      el.priceBreakdown.hidden = !open;
      el.priceBreakdownBtn.setAttribute('aria-expanded', String(open));
    });

    el.startOver.addEventListener('click', function () {
      store.clearSaved();
      store.replace(G.Recipe.initialState(recipe));
      el.restoredChip.hidden = true;
      syncAll();
    });
  }

  function syncAll() {
    var s = store.get();
    syncPhotoControls();

    var t = s.zones[zone.id].text || {};
    el.textInput.value = t.value || '';
    el.charCount.textContent = (t.value || '').length + '/' + (rule.maxChars || 40);
    el.textSize.value = Math.round((t.size || 0.2) * 100);
    el.textY.value = Math.round((t.y == null ? 0.5 : t.y) * 100);

    [].forEach.call(el.fontChips.children, function (c) {
      c.setAttribute('aria-pressed', String(c.dataset.font === t.font));
    });

    /* Undo changes the design, so every control has to follow it back. A stale
       swatch that still looks selected after an undo is a lie about the state. */
    markSwatch(el.textColours, t.color);
    var groups = el.colourParts.querySelectorAll('.cz-swatches');
    recipe.colorParts.forEach(function (part, i) {
      markSwatch(groups[i], s.colors[part.id]);
    });
  }

  function fail(message) {
    el.loading.textContent = message;
    el.loading.hidden = false;
  }

  function boot() {
    var id = new URLSearchParams(location.search).get('p') || 'mug';

    G.Recipe.load(id)
      .then(function (r) {
        recipe = r;
        document.title = 'Make your ' + r.name.toLowerCase() + '. Gifty';
        el.productName.textContent = r.name;
        return G.Recipe.loadImages(r);
      })
      .then(function (imgs) {
        images = imgs;
        return document.fonts ? document.fonts.ready : null;
      })
      .then(function () {
        cache = G.Render.prepare(recipe, images);
        zone = recipe.printZones[0];
        rule = (recipe.textRules || []).filter(function (t) { return t.zoneId === zone.id; })[0] || {};
        part0 = recipe.colorParts[0];

        var saved = G.State.loadSaved(recipe.id);
        var start = G.Recipe.initialState(recipe);
        store = G.State.create(start, onChange);
        wire();

        if (G.State.isMeaningful(saved)) {
          return G.State.hydrate(saved).then(function (s) {
            store.replace(s);
            el.restoredChip.hidden = false;
            syncAll();
          });
        }
        syncAll();
      })
      .then(function () {
        el.loading.hidden = true;
        /* Draw straight away rather than through requestAnimationFrame. rAF does
           not fire in a hidden or background tab, so a customizer opened in a
           second tab would sit blank until it was looked at. */
        G.Render.draw(el.preview, recipe, cache, images, store.get(), 1);
        /* And price it. Nothing has changed yet, so no change handler has run,
           and the markup's placeholder would otherwise stand as the price of
           every product on the site. */
        updatePrice(store.get());
        updateDpi(store.get());
      })
      .catch(function (err) {
        fail('We could not open the customizer just now. Please try again in a moment.');
        if (window.console) console.error(err);
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})(window.Gifty = window.Gifty || {});
