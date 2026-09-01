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
  var editingId = null;   /* set when the buyer came back from the cart to edit */

  /* Two previews of one design. 3D is the real object and is what opens; flat
     is the same drawing the proof and the print file come from, and it is where
     a photo is dragged into place, because in 3D a drag turns the object. Both
     are redrawn on every finished change so neither can go stale behind the
     other, and only the visible one is redrawn during a drag. */
  var scene = null;
  var mode = '3d';
  var VIEW_KEY = 'gifty.view';

  var el = {};
  ['preview', 'preview3d', 'viewToggle', 'viewTurn', 'viewFlat',
   'loading', 'productName', 'undoBtn', 'restoredChip', 'startOver', 'dpiChip',
   'photoInput', 'photoBtnLabel', 'removePhoto', 'photoHint', 'photoControls',
   'zoom', 'panX', 'panY', 'recentre', 'textInput', 'charCount', 'fontChips',
   'textColours', 'textColourField', 'textSize', 'textY', 'colourParts',
   'priceAmount', 'priceBreakdown', 'priceBreakdownBtn', 'addBtn', 'dock', 'zonePicker',
   'addedChip', 'addedText', 'deliverLine']
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

  /* `quick` skips rebuilding the artwork texture, which is what a colour change
     wants: the photo and the words have not moved, only the glaze under them. */
  function draw3d(quick) {
    if (!scene || scene.lost()) return;
    try { scene.update(store.get(), quick); }
    catch (e) { dropScene(e); }
  }

  /* A driver that dies mid session must not take the screen with it. The flat
     preview is always drawable, so falling back to it is a complete customizer
     rather than a broken one. */
  function dropScene(err) {
    if (window.console && err) console.warn('3D preview stopped:', err.message || err);
    scene = null;
    el.viewToggle.hidden = true;
    setMode('flat');
  }

  /* Which preview is on screen. Only one is, ever: two canvases stacked in the
     same box with the other display:none, so nothing is being drawn behind. */
  function setMode(next, opts) {
    if (next === '3d' && (!scene || scene.lost())) next = 'flat';
    mode = next;
    el.preview3d.hidden = (mode !== '3d');
    el.preview.hidden = (mode === '3d');
    el.viewTurn.setAttribute('aria-pressed', String(mode === '3d'));
    el.viewFlat.setAttribute('aria-pressed', String(mode === 'flat'));
    /* Only a choice is remembered. A device that cannot draw the object is
       pushed to flat every time, and writing that down would mean a phone that
       failed once opens flat forever after it stops failing. */
    if (opts && opts.remember) {
      try { localStorage.setItem(VIEW_KEY, mode); } catch (e) { /* private mode */ }
    }

    if (mode === '3d') {
      /* The canvas had no size while it was hidden, so the renderer has to be
         told to measure itself again before it draws anything. */
      draw3d(false);
      if (opts && opts.reveal && scene) scene.reveal();
    } else {
      G.Render.draw(el.preview, recipe, cache, images, store.get(), 1);
    }
    if (store) syncPhotoControls();
  }

  function onChange(state, meta) {
    var transient = !!(meta && meta.transient);
    if (transient) {
      if (mode === '3d') draw3d(false);
      else schedule(2);
    } else {
      schedule(1);
      draw3d(false);
    }
    updatePrice(state);
    updateDpi(state);
    el.undoBtn.disabled = !store.canUndo();
    /* Once the design moves on, "in the cart" is no longer true of what is on
       screen, so the confirmation goes rather than quietly becoming a lie. */
    if (!el.addedChip.hidden && !(meta && meta.transient)) el.addedChip.hidden = true;
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

  /* -------------------------------------------------------------- delivery */

  function paintDeliver() {
    if (!G.Delivery.settings() || !recipe) return;
    el.deliverLine.textContent =
      G.Delivery.sentence(G.Delivery.promise(recipe.leadTimeDays, G.Cart.zone()));
  }

  /* ------------------------------------------------------------------ cart

     The thumbnail is a downscale of the very canvas the buyer is looking at,
     so the picture in the cart is the design and cannot drift from it. P4
     re-renders the same state at print resolution for the proof. */

  function thumbOf() {
    var view = recipe.views[0];
    var c = document.createElement('canvas');
    c.width = 420;
    c.height = Math.round(420 * view.h / view.w);
    var ctx = c.getContext('2d');

    /* JPEG has no alpha and both previews are drawn on nothing, so without a
       ground every thumbnail in the cart comes back on black. */
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, c.width, c.height);

    var src = (mode === '3d' && scene && !scene.lost()) ? el.preview3d : el.preview;
    if (src === el.preview) {
      ctx.drawImage(src, 0, 0, c.width, c.height);
    } else if (src.width && src.height) {
      /* The 3D canvas is whatever shape the stage is, so it is fitted into the
         card's ratio rather than squashed to it. */
      var k = Math.min(c.width / src.width, c.height / src.height);
      var w = src.width * k, h = src.height * k;
      ctx.drawImage(src, (c.width - w) / 2, (c.height - h) / 2, w, h);
    }
    try { return c.toDataURL('image/jpeg', 0.82); } catch (e) { return null; }
  }

  function say(message, bad) {
    el.addedChip.hidden = false;
    el.addedChip.classList.toggle('cz-chip--warn', !!bad);
    el.addedChip.classList.toggle('cz-chip--added', !bad);
    el.addedText.textContent = message;
  }

  function addToCart() {
    var state = store.get();
    var price = G.Price.compute(recipe, state);
    var item = {
      productId: recipe.id,
      productName: recipe.name,
      leadTimeDays: recipe.leadTimeDays,
      unitPrice: price.total,
      lines: price.lines,
      thumb: thumbOf(),
      snapshot: G.State.snapshot(state)
    };

    el.addBtn.disabled = true;
    var job = editingId ? G.Cart.replace(editingId, item) : G.Cart.add(item);

    job.then(function (entry) {
      el.addBtn.disabled = false;
      if (!entry) {
        /* The store is full, which is ours to explain and not the buyer's
           fault. Give them the way out rather than a storage error. */
        say('We could not keep that one. This phone has run out of room for saved designs, so take something out of the cart and try again.', true);
        return;
      }
      say(editingId ? 'Cart updated.' : 'In the cart.', false);
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
    /* In 3D a drag turns the object, so promising that it moves the photo
       would be a lie. The sliders do the same job in both views. */
    var flat = (mode === 'flat');
    el.photoHint.textContent = has
      ? (flat ? 'Drag it on the preview to move it, or use the sliders.'
              : 'Use the sliders to move it, or switch to Flat and drag it.')
      : (flat ? 'Pick a photo from your phone. Drag it on the preview to move it.'
              : 'Pick a photo from your phone, then turn it to see it wrap.');
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
          var panel = $(t.getAttribute('aria-controls'));
          panel.hidden = !on;
          /* Three panels share one rectangle, and swapping one for another with
             nothing in between reads as a repaint rather than as a change. The
             class is taken off when the animation ends, so it is never on a
             panel that is simply sitting there. */
          if (!on) return;
          panel.classList.remove('is-switching');
          void panel.offsetWidth;
          panel.classList.add('is-switching');
        });
      });
    });

    document.addEventListener('animationend', function (e) {
      if (e.animationName === 'panel-in' && e.target.classList) {
        e.target.classList.remove('is-switching');
      }
    }, true);
  }

  /* ------------------------------------------------------------- canvas drag
     Tracks the finger one to one. Every drag also has a slider, so the whole
     screen is usable without dragging at all. */

  function wireDrag() {
    var dragging = false, lastX = 0, lastY = 0, pointer = null;

    el.preview.addEventListener('pointerdown', function (e) {
      if (mode !== 'flat') return;
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

    el.addBtn.addEventListener('click', addToCart);

    el.viewTurn.addEventListener('click', function () {
      setMode('3d', { reveal: true, remember: true });
    });
    el.viewFlat.addEventListener('click', function () {
      setMode('flat', { remember: true });
    });

    /* The stage changes shape when the dock grows, when the phone turns, and
       when the keyboard opens. The 3D canvas has no intrinsic ratio to fall
       back on, so it has to be told. */
    if (window.ResizeObserver) {
      new ResizeObserver(function () {
        if (mode === '3d' && scene && !scene.lost()) {
          try { scene.resize(); } catch (e) { dropScene(e); }
        }
      }).observe(el.preview3d.parentNode);
    } else {
      window.addEventListener('resize', function () {
        if (mode === '3d' && scene && !scene.lost()) scene.resize();
      });
    }

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

  /* ---------------------------------------------------------- what to open

     Three ways in, and the URL decides which. A template or a cart item wins
     over the autosave and clears it, because the link is what says which
     design this screen is showing and a refresh has to land on the same one. */

  function fromTemplate(tpl) {
    var state = G.Recipe.initialState(recipe);
    var src = tpl.state || {};

    Object.keys(src.colors || {}).forEach(function (k) {
      if (k in state.colors) state.colors[k] = src.colors[k];
    });

    Object.keys(src.zones || {}).forEach(function (id) {
      if (!state.zones[id] || !src.zones[id].text) return;
      var from = src.zones[id].text, into = state.zones[id].text;
      ['value', 'font', 'color', 'size', 'y'].forEach(function (k) {
        if (from[k] != null) into[k] = from[k];
      });
      var zrule = (recipe.textRules || []).filter(function (r) { return r.zoneId === id; })[0] || {};
      into.value = G.Design.applyTextRules(zrule, into.value);
    });

    return state;
  }

  function openWith(params) {
    if (params.cartId) {
      var item = G.Cart.find(params.cartId);
      if (item) {
        editingId = item.id;
        el.addBtn.textContent = 'Update the cart';
        store.clearSaved();
        return G.State.hydrate(item.snapshot).then(function (s) { store.replace(s); });
      }
    }

    if (params.templateId) {
      return G.Data.doc('templates/' + params.templateId)
        .then(function (tpl) {
          if (!tpl || tpl.productId !== recipe.id) return;
          store.clearSaved();
          store.replace(fromTemplate(tpl));
        })
        .catch(function () { /* a missing template opens a blank one, not an error */ });
    }

    var saved = G.State.loadSaved(recipe.id);
    if (G.State.isMeaningful(saved)) {
      return G.State.hydrate(saved).then(function (s) {
        store.replace(s);
        el.restoredChip.hidden = false;
      });
    }
    return Promise.resolve();
  }

  function boot() {
    var q = new URLSearchParams(location.search);
    var id = q.get('p') || 'mug';
    var params = { templateId: q.get('t'), cartId: q.get('c') };

    /* The date is not on the critical path for drawing, so it loads alongside
       and fills itself in. A slow settings fetch never holds up the preview. */
    G.Delivery.load().then(function () {
      paintDeliver();
      setInterval(paintDeliver, 30000);
    }).catch(function () { el.deliverLine.hidden = true; });

    G.Recipe.load(id)
      .then(function (r) {
        recipe = r;
        document.title = 'Make your ' + r.name.toLowerCase() + '. Gifty';
        el.productName.textContent = r.name;
        return G.Recipe.loadImages(r);
      })
      .then(function (imgs) {
        images = imgs;
        return G.Design.ready();
      })
      .then(function () {
        cache = G.Render.prepare(recipe, images);
        zone = recipe.printZones[0];
        rule = (recipe.textRules || []).filter(function (t) { return t.zoneId === zone.id; })[0] || {};
        part0 = recipe.colorParts[0];

        store = G.State.create(G.Recipe.initialState(recipe), onChange);
        wire();

        return openWith(params).then(syncAll);
      })
      .then(function () {
        el.loading.hidden = true;

        /* The real object, if this recipe describes one and this device can
           draw one. Everything below still works when it cannot: the flat
           preview is the whole customizer on its own and always has been. */
        if (recipe.model && G.Scene && G.Scene.supported()) {
          try {
            scene = G.Scene.create(el.preview3d, recipe);
          } catch (e) {
            scene = null;
            if (window.console) console.warn('3D preview unavailable:', e.message);
          }
        }
        el.viewToggle.hidden = !scene;
        if (scene) scene.onLost = function () { dropScene(); };

        var saved = null;
        try { saved = localStorage.getItem(VIEW_KEY); } catch (e) {}
        var opening = (saved === 'flat' || !scene) ? 'flat' : '3d';

        /* Draw straight away rather than through requestAnimationFrame. rAF does
           not fire in a hidden or background tab, so a customizer opened in a
           second tab would sit blank until it was looked at. */
        el.preview.classList.add('is-first');
        el.preview3d.classList.add('is-first');
        G.Render.draw(el.preview, recipe, cache, images, store.get(), 1);
        setMode(opening);
        /* Two frames, so the hidden class is really in effect before the class
           that reveals it lands, or the transition never runs at all. */
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            el.preview.classList.add('is-ready');
            el.preview3d.classList.add('is-ready');
            /* One turn, once, and only when the object is what is on screen.
               It says "this can be turned" in a second and a half, which no
               label on a button manages. */
            if (opening === '3d' && scene) {
              try { scene.reveal(); } catch (e) { dropScene(e); }
            }
          });
        });
        /* And price it. Nothing has changed yet, so no change handler has run,
           and the markup's placeholder would otherwise stand as the price of
           every product on the site. */
        updatePrice(store.get());
        updateDpi(store.get());
        paintDeliver();
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
