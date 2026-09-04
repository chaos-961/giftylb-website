/* Gifty. The customizer screen.
 *
 * This file owns the interface. It owns no drawing and no product knowledge:
 * everything it renders comes out of the recipe, which is why the same screen
 * serves a mug, a cap, a bottle, a tote, a photo block and a moon print
 * without a branch.
 *
 * Every slider is one line in a table below. The table says which key on the
 * state it moves, its range and how to say its value, and one builder makes
 * the control, wires it, syncs it after undo and resets it on a double tap.
 * Adding an option is adding a row, plus its default in Design and its bound
 * in the release check.
 */
(function (G) {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var recipe = null, images = null, cache = null, store = null;
  var zone = null, rule = null;
  var frame = null, pending = 1, lastTotal = null;
  var editingId = null;   /* set when the buyer came back from the cart to edit */

  /* Two previews of one design. 3D is the real object and is what opens; the
     design view is the same drawing the proof and the print file come from,
     and it is where a photo or a line of words is dragged into place, because
     in 3D a drag turns the object. Both are redrawn on every finished change
     so neither can go stale behind the other, and only the visible one is
     redrawn during a drag. */
  var scene = null;
  var mode = '3d';
  var VIEW_KEY = 'gifty.view';

  var el = {};
  ['preview', 'preview3d', 'viewToggle', 'viewTurn', 'viewFlat',
   'loading', 'productName', 'undoBtn', 'redoBtn', 'restoredChip', 'startOver', 'dpiChip',
   'moonControls', 'moonDate', 'moonTime', 'moonSay', 'photoCta',
   'photoInput', 'photoBtnLabel', 'removePhoto', 'photoHint', 'photoControls',
   'photoSliders', 'photoAdjust', 'photoLookField', 'photoShapeField',
   'recentre', 'rotateBtn', 'flipBtn', 'photoFilters', 'photoShapes',
   'textInput', 'charCount', 'linesHint', 'textDragHint', 'fontChips',
   'textColours', 'textColourField', 'textColours2', 'textColour2Field',
   'textSliders', 'textFine', 'textAlign',
   'textEffects', 'textCaps', 'textOutline', 'textShadow', 'textPlates', 'textPlateField',
   'colourParts', 'priceAmount', 'priceBreakdown', 'priceBreakdownBtn', 'addBtn', 'dock', 'zonePicker',
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

  function setMode(next, opts) {
    if (next === '3d' && (!scene || scene.lost())) next = 'flat';
    mode = next;
    el.preview3d.hidden = (mode !== '3d');
    el.preview.hidden = (mode === '3d');
    el.viewTurn.setAttribute('aria-pressed', String(mode === '3d'));
    el.viewFlat.setAttribute('aria-pressed', String(mode === 'flat'));
    if (opts && opts.remember) {
      try { localStorage.setItem(VIEW_KEY, mode); } catch (e) { /* private mode */ }
    }
    if (mode === '3d') {
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
    el.redoBtn.disabled = !store.canRedo();
    if (!el.addedChip.hidden && !transient) el.addedChip.hidden = true;
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

  /* ------------------------------------------------------------------ cart */

  function thumbOf() {
    var view = recipe.views[0];
    var c = document.createElement('canvas');
    c.width = 420;
    c.height = Math.round(420 * view.h / view.w);
    var ctx = c.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, c.width, c.height);

    var src = (mode === '3d' && scene && !scene.lost()) ? el.preview3d : el.preview;
    if (src === el.preview) {
      ctx.drawImage(src, 0, 0, c.width, c.height);
    } else if (src.width && src.height) {
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
    if (!photo || !photo.image || photo.moon) { el.dpiChip.hidden = true; return; }

    var check = G.Photo.check(zone, photo);
    if (!check || check.ok) { el.dpiChip.hidden = true; return; }

    el.dpiChip.hidden = false;
    el.dpiChip.textContent = '';

    var text = document.createElement('span');
    text.textContent = 'This will print a little soft at that size. Zoom out a bit, or use a bigger photo.';
    el.dpiChip.appendChild(text);

    if (!cropCanvas) {
      cropCanvas = document.createElement('canvas');
      cropCanvas.className = 'cz-crop';
      cropCanvas.width = 132;
      cropCanvas.height = 92;
    }
    el.dpiChip.appendChild(cropCanvas);

    var size = G.Design.sizeFor(zone);
    var cw = cropCanvas.width, ch = cropCanvas.height;
    var ratio = check.dpi / check.min;
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

  /* ---------------------------------------------------------------- sliders

     One builder for every range control. A row names the key it moves on the
     text or the photo, the slider's whole numbers, the divisor that turns
     them into the state's value, and how to read the value back to a person.
     `def` is what a double tap resets to; null means "the face's own", which
     the state stores as null too. */

  var sliders = [];

  function pct(v) { return Math.round(v) + '%'; }
  function deg(v) { return Math.round(v) + '°'; }
  function signed(v) { return (v > 0 ? '+' : '') + Math.round(v); }

  var TEXT_MAIN = [
    { key: 'size', label: 'Size', min: 8, max: 34, step: 1, div: 100, def: 20, say: pct },
    { key: 'y', label: 'Up and down', min: 10, max: 90, step: 1, div: 100, def: 50, say: pct },
    { key: 'x', label: 'Across', min: 5, max: 95, step: 1, div: 100, def: null, say: pct,
      read: function (t) { return t.x == null ? (t.align === 'left' ? 5 : t.align === 'right' ? 95 : 50) : t.x * 100; } },
    { key: 'rotate', label: 'Tilt', min: -45, max: 45, step: 1, div: 1, def: 0, say: deg },
    { key: 'arc', label: 'Curve', min: -60, max: 60, step: 5, div: 1, def: 0,
      say: function (v) { return !v ? 'Straight' : (v > 0 ? 'Smile' : 'Frown'); } },
    { key: 'spacing', label: 'Letter spacing', min: -5, max: 30, step: 1, div: 100, def: 0, say: signed }
  ];
  var TEXT_FINE = [
    { key: 'lineHeight', label: 'Line spacing', min: 90, max: 160, step: 2, div: 100, def: 112, say: pct },
    { key: 'weight', label: 'Weight', min: 300, max: 800, step: 50, div: 1, def: null,
      read: function (t) { return t.weight || (t.font === 'display' ? 700 : 600); },
      say: function (v) { return v <= 350 ? 'Light' : v <= 500 ? 'Regular' : v <= 650 ? 'Medium' : v <= 750 ? 'Bold' : 'Black'; } },
    { key: 'opacity', label: 'Opacity', min: 20, max: 100, step: 1, div: 100, def: 100, say: pct },
    { key: 'outlineWidth', label: 'Outline width', min: 3, max: 20, step: 1, div: 100, def: 9, say: pct }
  ];
  var PHOTO_ADJUST = [
    { key: 'bright', label: 'Brightness', min: -50, max: 50, step: 1, div: 100, def: 0, say: signed },
    { key: 'contrast', label: 'Contrast', min: -50, max: 50, step: 1, div: 100, def: 0, say: signed },
    { key: 'sat', label: 'Colour', min: -100, max: 100, step: 1, div: 100, def: 0, say: signed },
    { key: 'feather', label: 'Soft edge', min: 0, max: 100, step: 1, div: 100, def: 0, say: pct },
    { key: 'border', label: 'Border', min: 0, max: 12, step: 1, div: 100, def: 0, say: pct },
    { key: 'vignette', label: 'Vignette', min: 0, max: 100, step: 1, div: 100, def: 0, say: pct },
    { key: 'opacity', label: 'Opacity', min: 20, max: 100, step: 1, div: 100, def: 100, say: pct }
  ];

  function textOf(s) { return s.zones[zone.id].text; }
  function photoOf(s) { return s.zones[zone.id].photo; }

  /* target: which object the key lives on. `get` and `set` may be replaced
     for the two photo controls that are not a plain key. */
  function slider(container, spec, target) {
    var wrap = document.createElement('label');
    wrap.className = 'cz-field cz-slider';
    var label = document.createElement('span');
    label.className = 'cz-label';
    var name = document.createElement('span'); name.textContent = spec.label;
    var out = document.createElement('span'); out.className = 'cz-count';
    label.appendChild(name); label.appendChild(out);
    var input = document.createElement('input');
    input.type = 'range';
    input.min = spec.min; input.max = spec.max; input.step = spec.step || 1;
    wrap.appendChild(label); wrap.appendChild(input);
    container.appendChild(wrap);

    var get = spec.get || function (s) {
      var o = target(s);
      if (!o) return spec.def == null ? spec.min : spec.def;
      if (spec.read) return spec.read(o);
      var v = o[spec.key];
      if (v == null) v = spec.def == null ? spec.min : spec.def;
      else v = v * spec.div;
      return v;
    };
    var set = spec.set || function (s, v) {
      var o = target(s);
      if (o) o[spec.key] = v / spec.div;
    };

    function show(v) { out.textContent = spec.say ? spec.say(v) : String(Math.round(v)); }

    input.addEventListener('input', function () {
      var v = +input.value;
      store.touch(function (s) { set(s, v); });
      show(v);
    });
    input.addEventListener('change', function () { store.commit(function () {}); syncAll(); });
    /* A double tap puts a control back where it started, which is the one
       thing a slider cannot say for itself. */
    input.addEventListener('dblclick', function () {
      store.commit(function (s) {
        if (spec.reset) spec.reset(s);
        else { var o = target(s); if (o) o[spec.key] = spec.def == null ? null : spec.def / spec.div; }
      });
      syncAll();
    });

    var handle = { input: input, sync: function (s) {
      var v = get(s);
      input.value = v;
      show(v);
      if (spec.enabled) input.disabled = !spec.enabled(s);
    } };
    sliders.push(handle);
    return handle;
  }

  /* The photo's own placement: zoom about the centre, and two pans that only
     have anything to do when the picture is bigger than the print area. */
  function buildPhotoSliders() {
    slider(el.photoSliders, {
      key: 'zoom', label: 'Zoom', min: 25, max: 400, step: 1, say: pct, def: 100,
      get: function (s) {
        var p = photoOf(s); if (!p) return 100;
        var size = G.Design.sizeFor(zone);
        return Math.round(Math.min(400, Math.max(25, p.k / G.Design.coverScale(p, size.w, size.h) * 100)));
      },
      set: function (s, v) {
        var p = photoOf(s); if (!p) return;
        var size = G.Design.sizeFor(zone);
        var min = G.Design.coverScale(p, size.w, size.h);
        var cxd = (size.w / 2 - p.ox) / p.k, cyd = (size.h / 2 - p.oy) / p.k;
        p.k = min * (v / 100);
        p.ox = size.w / 2 - cxd * p.k;
        p.oy = size.h / 2 - cyd * p.k;
        G.Photo.clamp(p, zone);
      },
      reset: function (s) { var p = photoOf(s); if (p) G.Photo.fitCover(p, zone); }
    }, photoOf);
    ['x', 'y'].forEach(function (axis) {
      slider(el.photoSliders, {
        key: 'pan' + axis, label: axis === 'x' ? 'Move across' : 'Move up and down',
        min: 0, max: 100, step: 1, say: pct, def: 50,
        get: function (s) {
          var p = photoOf(s); if (!p) return 50;
          var size = G.Design.sizeFor(zone);
          var range = axis === 'x' ? size.w - p.natW * p.k : size.h - p.natH * p.k;
          var o = axis === 'x' ? p.ox : p.oy;
          return Math.round(Math.min(100, Math.max(0, 50 + (o - range / 2) / Math.max(1, Math.abs(range) || size.w) * 100)));
        },
        set: function (s, v) {
          var p = photoOf(s); if (!p) return;
          var size = G.Design.sizeFor(zone);
          var range = axis === 'x' ? size.w - p.natW * p.k : size.h - p.natH * p.k;
          var o = range / 2 + (v - 50) / 100 * Math.max(1, Math.abs(range) || size.w);
          if (axis === 'x') p.ox = o; else p.oy = o;
          G.Photo.clamp(p, zone);
        },
        reset: function (s) { var p = photoOf(s); if (p) G.Photo.fitCover(p, zone); }
      }, photoOf);
    });
    slider(el.photoSliders, { key: 'angle', label: 'Tilt', min: -45, max: 45, step: 1, div: 1, def: 0, say: deg }, photoOf);
    PHOTO_ADJUST.forEach(function (spec) { slider(el.photoAdjust, spec, photoOf); });
  }

  function buildTextSliders() {
    TEXT_MAIN.forEach(function (spec) { slider(el.textSliders, spec, textOf); });
    TEXT_FINE.forEach(function (spec) { slider(el.textFine, spec, textOf); });
  }

  /* ------------------------------------------------------------ photo pane */

  function zoneTakes(kind) { return (zone.accepts || ['photo', 'text']).indexOf(kind) >= 0; }

  function syncPhotoControls() {
    var photo = store.get().zones[zone.id].photo;
    var has = !!(photo && photo.image);
    var moon = zoneTakes('moon');
    el.photoControls.hidden = !has;
    el.removePhoto.hidden = !has || moon;
    el.photoBtnLabel.textContent = has ? 'Change photo' : 'Add a photo';
    var flat = (mode === 'flat');
    if (moon) {
      el.photoHint.textContent = has
        ? (flat ? 'Drag the moon to place it, pinch or scroll to size it.' : 'Turn the frame to see it, or switch to Design to move the moon.')
        : 'Pick the date, and the time if you know it.';
    } else {
      el.photoHint.textContent = has
        ? (flat ? 'Drag it to move it, pinch or scroll to zoom. Drag the words too.'
                : 'Use the sliders to place it, or switch to Design and drag it.')
        : (flat ? 'Pick a photo from your phone, then drag it into place.'
                : 'Pick a photo from your phone, then turn it to see it wrap.');
    }
    if (!has) return;
    markChips(el.photoFilters, 'filter', photo.filter || 'none');
    markChips(el.photoShapes, 'shape', photo.shape || 'rect');
  }

  function buildChips(container, key, items, onPick) {
    container.innerHTML = '';
    items.forEach(function (it) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'cz-chipbtn';
      b.dataset[key] = it.id;
      b.textContent = it.label;
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', function () { onPick(it.id); markChips(container, key, it.id); });
      container.appendChild(b);
    });
  }

  function markChips(container, key, value) {
    if (!container) return;
    [].forEach.call(container.children, function (c) {
      c.setAttribute('aria-pressed', String(c.dataset[key] === String(value)));
    });
  }

  var FILTER_NAMES = { none: 'As it is', mono: 'Black and white', sepia: 'Sepia', warm: 'Warm', cool: 'Cool', pop: 'Pop' };
  var SHAPE_NAMES = { rect: 'Full', soft: 'Soft corners', round: 'Round', heart: 'Heart', arch: 'Arch', hex: 'Hexagon', diamond: 'Diamond', star: 'Star' };
  var PLATE_NAMES = { none: 'Nothing', pill: 'Pill', box: 'Box', line: 'Underline' };
  var PATTERN_NAMES = { none: 'Plain', dots: 'Dots', stripes: 'Stripes', grid: 'Grid', rays: 'Rays' };

  function named(list, names) {
    return list.map(function (id) { return { id: id, label: names[id] || id }; });
  }

  function buildPhotoChips() {
    buildChips(el.photoFilters, 'filter', named(G.Design.FILTERS, FILTER_NAMES), function (f) {
      store.commit(function (s) { photoOf(s).filter = f; });
    });
    buildChips(el.photoShapes, 'shape', named(G.Design.SHAPES, SHAPE_NAMES), function (f) {
      store.commit(function (s) { photoOf(s).shape = f; });
    });
  }

  function setPhoto(file) {
    G.Photo.fromFile(file, zone)
      .then(function (photo) {
        store.commit(function (s) { s.zones[zone.id].photo = photo; });
        syncAll();
      })
      .catch(function (err) {
        el.photoHint.textContent = err.message;
      });
  }

  /* ------------------------------------------------------------------ moon */

  function moonIso() {
    var d = el.moonDate.value, t = el.moonTime.value || '21:00';
    if (!d) return null;
    return d + 'T' + t;
  }

  var moonJob = 0;
  function setMoon() {
    var iso = moonIso();
    if (!iso) return;
    var mine = ++moonJob;
    el.moonSay.textContent = 'Working out the sky';
    G.State.moonPhoto(iso, zone).then(function (photo) {
      if (mine !== moonJob) return;
      store.commit(function (s) {
        var old = photoOf(s);
        /* A new date keeps the old placement, so a buyer who sized the disc
           does not lose that to a change of night. */
        if (old && old.moon) {
          photo.k = old.k; photo.ox = old.ox; photo.oy = old.oy;
          photo.shape = old.shape; photo.opacity = old.opacity;
        }
        s.zones[zone.id].photo = photo;
        /* The caption fills itself in the first time, and never overwrites
           words the buyer typed. */
        var cap = s.zones.caption;
        if (cap && cap.text && !String(cap.text.value || '').trim()) {
          cap.text.value = G.State.moonCaption ? G.State.moonCaption(iso) : '';
        }
      });
      sayMoon(iso);
      syncAll();
    }).catch(function () {
      el.moonSay.textContent = 'We could not draw that night. Try another date.';
    });
  }

  function sayMoon(iso) {
    if (!G.Moon) return;
    var d = G.Moon.describe(G.Moon.stateAt(new Date(iso)));
    el.moonSay.textContent = d.phase + ', ' + d.illumination + '% lit, ' + d.ageDays + ' days old, ' + d.distanceLabel + '.';
  }

  /* "14 June 1996, waning gibbous" for the caption strip. Kept on State so
     the same words can be built wherever a moon is drawn. */
  G.State.moonCaption = function (iso) {
    if (!G.Moon) return '';
    var date = new Date(iso);
    var d = G.Moon.describe(G.Moon.stateAt(date));
    var when = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }).format(date);
    return when + ', ' + d.phase.toLowerCase();
  };

  function syncMoon() {
    var photo = store.get().zones[zone.id].photo;
    if (photo && photo.moon && photo.moon.iso) {
      var parts = photo.moon.iso.split('T');
      el.moonDate.value = parts[0];
      el.moonTime.value = parts[1] || '21:00';
      sayMoon(photo.moon.iso);
    }
  }

  /* --------------------------------------------------------------- controls */

  function buildFontChips() {
    el.fontChips.innerHTML = '';
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
        store.commit(function (s) { textOf(s).font = f; textOf(s).weight = null; });
        syncAll();
      });
      el.fontChips.appendChild(b);
    });
  }

  /* A row of colours, with an optional hollow "none" first and a free colour
     last, because a print shop can print any colour and a palette is a
     suggestion, not a wall. The free swatch is a native colour input. */
  function buildSwatches(container, palette, current, onPick, opts) {
    opts = opts || {};
    container.innerHTML = '';
    var list = (opts.none ? [{ hex: 'NONE', name: opts.none }] : []).concat(palette);
    list.forEach(function (c) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'cz-swatch' + (c.hex === 'NONE' ? ' cz-swatch--none' : '');
      b.dataset.hex = c.hex.toUpperCase();
      if (c.hex !== 'NONE') b.style.background = c.hex;
      b.title = c.name;
      b.setAttribute('aria-label', c.name);
      b.addEventListener('click', function () { onPick(c.hex === 'NONE' ? null : c.hex); markSwatch(container, c.hex); });
      container.appendChild(b);
    });
    if (opts.custom !== false) {
      var lab = document.createElement('label');
      lab.className = 'cz-swatch cz-swatch--custom';
      lab.title = 'Any colour';
      var inp = document.createElement('input');
      inp.type = 'color';
      /* Visually hidden, not opacity zero: the label is the swatch and a
         click on it opens the picker. */
      inp.className = 'visually-hidden';
      inp.setAttribute('aria-label', 'Any colour');
      inp.addEventListener('input', function () {
        store.touch(function () { onPick(inp.value.toUpperCase(), true); });
        lab.style.background = inp.value;
      });
      inp.addEventListener('change', function () { store.commit(function () {}); markSwatch(container, inp.value); });
      lab.appendChild(inp);
      container.appendChild(lab);
    }
    markSwatch(container, current == null ? 'NONE' : current);
  }

  function markSwatch(container, hex) {
    if (!container) return;
    var want = String(hex || 'NONE').toUpperCase();
    var hit = false;
    [].forEach.call(container.children, function (n) {
      var on = n.dataset.hex === want;
      if (on) hit = true;
      n.setAttribute('aria-pressed', String(on));
    });
    var custom = container.querySelector('.cz-swatch--custom');
    if (custom) {
      custom.setAttribute('aria-pressed', String(!hit && want !== 'NONE'));
      if (!hit && want !== 'NONE') { custom.style.background = want; custom.firstChild.value = want; }
    }
  }

  /* A print zone that allows a background gets its own swatch row, a second
     colour to fade into, and a pattern. They live on the style tab because
     that is where a buyer looks for colour, whichever part it lands on. */
  function buildFillRows() {
    (recipe.printZones || []).forEach(function (z) {
      if (!z.fills || !z.fills.length) return;
      var st = store.get().zones[z.id];
      var wrap = document.createElement('div');
      wrap.className = 'cz-part';
      wrap.dataset.fillZone = z.id;

      function row(title, cls) {
        var h = document.createElement('p'); h.className = 'cz-partname'; h.textContent = title;
        var r = document.createElement('div'); r.className = cls;
        r.setAttribute('role', 'group'); r.setAttribute('aria-label', title);
        wrap.appendChild(h); wrap.appendChild(r);
        return r;
      }
      var fill = row((z.name || z.id) + ' background', 'cz-swatches');
      fill.dataset.role = 'fill';
      buildSwatches(fill, z.fills, st.fill, function (hex, live) {
        var apply = function (s) { s.zones[z.id].fill = hex; if (!hex) { s.zones[z.id].fill2 = null; } };
        if (live) apply(store.get()); else store.commit(apply);
        if (!live) syncAll();
      }, { none: 'No background' });

      var fill2 = row('Fade into', 'cz-swatches');
      fill2.dataset.role = 'fill2';
      buildSwatches(fill2, z.fills, st.fill2, function (hex, live) {
        var apply = function (s) { s.zones[z.id].fill2 = hex; };
        if (live) apply(store.get()); else store.commit(apply);
      }, { none: 'One colour' });

      var pat = row('Pattern', 'cz-chips');
      pat.dataset.role = 'pattern';
      buildChips(pat, 'pattern', named(G.Design.PATTERNS, PATTERN_NAMES), function (p) {
        store.commit(function (s) { s.zones[z.id].pattern = p === 'none' ? null : p; });
      });
      el.colourParts.appendChild(wrap);
    });
  }

  function buildColourParts() {
    el.colourParts.innerHTML = '';
    recipe.colorParts.forEach(function (part) {
      var wrap = document.createElement('div');
      wrap.className = 'cz-part';
      wrap.dataset.part = part.id;
      var h = document.createElement('p');
      h.className = 'cz-partname';
      h.textContent = part.name;
      var row = document.createElement('div');
      row.className = 'cz-swatches';
      row.setAttribute('role', 'group');
      row.setAttribute('aria-label', part.name);
      wrap.appendChild(h); wrap.appendChild(row);
      el.colourParts.appendChild(wrap);
      /* Product colours stay on the palette: those are the coats and cloths
         the workshop actually stocks. */
      buildSwatches(row, part.palette, store.get().colors[part.id], function (hex) {
        store.commit(function (s) { s.colors[part.id] = hex; });
      }, { custom: false });
    });
    buildFillRows();
  }

  function buildPlateChips() {
    buildChips(el.textPlates, 'plate', named(G.Design.PLATES, PLATE_NAMES), function (p) {
      store.commit(function (s) { textOf(s).plate = p; });
    });
  }

  /* Switching the active zone re-points every text and photo control at it.
     Products with one zone never see this. The photo block has two, a printed
     acrylic face and an engraved caption, and they take different rules. */
  function applyZone(next) {
    zone = next;
    rule = (recipe.textRules || []).filter(function (t) { return t.zoneId === zone.id; })[0] || {};

    var canPhoto = zoneTakes('photo'), canMoon = zoneTakes('moon'), canText = zoneTakes('text');

    $('tab-photo').hidden = !(canPhoto || canMoon);
    $('tab-photo').textContent = canMoon ? 'Moon' : 'Photo';
    $('tab-text').hidden = !canText;
    el.moonControls.hidden = !canMoon;
    el.photoCta.hidden = !canPhoto;
    el.photoLookField.hidden = canMoon;
    el.photoShapeField.hidden = canMoon;
    $('photoMore').hidden = canMoon;

    el.textInput.maxLength = rule.maxChars || 40;
    var maxLines = rule.maxLines || 1;
    el.linesHint.hidden = maxLines < 2;
    el.linesHint.textContent = 'Up to ' + maxLines + ' lines. Press Enter for a new one.';
    /* An etch has no colour and no shadow, and a stroke around a groove is
       nonsense, so those go away on an engraved zone. */
    el.textEffects.hidden = !!rule.engraved;
    el.textPlateField.hidden = !!rule.engraved;
    el.textColour2Field.hidden = !!rule.engraved || rule.colorLocked || !rule.palette;
    buildFontChips();

    if (rule.colorLocked || !rule.palette) {
      el.textColourField.hidden = true;
    } else {
      el.textColourField.hidden = false;
      buildSwatches(el.textColours, rule.palette, store.get().zones[zone.id].text.color, function (hex, live) {
        var apply = function (st) { textOf(st).color = hex || rule.defaultColor; };
        if (live) apply(store.get()); else store.commit(apply);
      });
      buildSwatches(el.textColours2, rule.palette, store.get().zones[zone.id].text.color2, function (hex, live) {
        var apply = function (st) { textOf(st).color2 = hex; };
        if (live) apply(store.get()); else store.commit(apply);
      }, { none: 'One colour' });
    }

    var wanted = (canPhoto || canMoon) ? 'tab-photo' : 'tab-text';
    if ($(wanted)) $(wanted).click();

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

  /* ---------------------------------------------------------- design view

     Direct manipulation on the flat preview. A finger on the words moves the
     words; a finger anywhere else on the zone moves the photo; two fingers
     zoom the photo; a wheel zooms it too. Every gesture also has a slider, so
     the whole screen is usable without dragging at all. The canvas is
     letterboxed inside its box by object-fit, so pointer positions are mapped
     through the box the picture actually occupies. */

  var hitCanvas = null;

  function frameOf() {
    var rect = el.preview.getBoundingClientRect();
    var view = recipe.views[0];
    var k = Math.min(rect.width / view.w, rect.height / view.h);
    return { left: rect.left + (rect.width - view.w * k) / 2, top: rect.top + (rect.height - view.h * k) / 2, k: k };
  }

  /* A screen point in zone pixels. */
  function zonePoint(e) {
    var f = frameOf();
    var size = G.Design.sizeFor(zone);
    var vx = (e.clientX - f.left) / f.k, vy = (e.clientY - f.top) / f.k;
    return { x: (vx - zone.rect.x) * size.w / zone.rect.w, y: (vy - zone.rect.y) * size.h / zone.rect.h,
             sx: size.w / zone.rect.w / f.k, sy: size.h / zone.rect.h / f.k, size: size };
  }

  function overText(p) {
    var t = store.get().zones[zone.id].text;
    if (!t || !zoneTakes('text')) return false;
    if (!hitCanvas) hitCanvas = document.createElement('canvas');
    var box = G.Design.textBox(hitCanvas.getContext('2d'), zone, rule, t, p.size.w, p.size.h);
    if (!box) return false;
    var pad = box.px * 0.4;
    return p.x >= box.x - pad && p.x <= box.x + box.w + pad && p.y >= box.y - pad && p.y <= box.y + box.h + pad;
  }

  function wireDrag() {
    var pointers = {}, count = 0;
    var target = null, last = null, pinch = null;

    function zoomPhoto(p, factor, about) {
      var size = G.Design.sizeFor(zone);
      var min = G.Design.coverScale(p, size.w, size.h);
      var k = Math.min(min * 4, Math.max(min * G.Photo.MIN_ZOOM, p.k * factor));
      var ax = about ? about.x : size.w / 2, ay = about ? about.y : size.h / 2;
      var cxd = (ax - p.ox) / p.k, cyd = (ay - p.oy) / p.k;
      p.k = k;
      p.ox = ax - cxd * k;
      p.oy = ay - cyd * k;
      G.Photo.clamp(p, zone);
    }

    el.preview.addEventListener('pointerdown', function (e) {
      if (mode !== 'flat') return;
      pointers[e.pointerId] = e;
      count++;
      el.preview.setPointerCapture(e.pointerId);
      var p = zonePoint(e);
      if (count === 1) {
        var photo = photoOf(store.get());
        target = overText(p) ? 'text' : (photo && photo.image ? 'photo' : null);
        last = p;
        if (target) el.preview.classList.add('is-dragging');
      } else if (count === 2) {
        var ids = Object.keys(pointers);
        var a = zonePoint(pointers[ids[0]]), b = zonePoint(pointers[ids[1]]);
        var photo2 = photoOf(store.get());
        pinch = photo2 ? { d: Math.hypot(a.x - b.x, a.y - b.y), k: photo2.k } : null;
        target = pinch ? 'pinch' : null;
      }
    });

    el.preview.addEventListener('pointermove', function (e) {
      if (!pointers[e.pointerId] || !target) return;
      pointers[e.pointerId] = e;
      if (target === 'pinch' && count >= 2) {
        var ids = Object.keys(pointers);
        var a = zonePoint(pointers[ids[0]]), b = zonePoint(pointers[ids[1]]);
        var d = Math.hypot(a.x - b.x, a.y - b.y);
        store.touch(function (s) {
          var p = photoOf(s);
          if (!p || !pinch) return;
          zoomPhoto(p, (pinch.k * d / Math.max(1, pinch.d)) / p.k, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
        });
        return;
      }
      var p = zonePoint(e);
      var dx = p.x - last.x, dy = p.y - last.y;
      last = p;
      store.touch(function (s) {
        if (target === 'photo') {
          var ph = photoOf(s);
          ph.ox += dx; ph.oy += dy;
          G.Photo.clamp(ph, zone);
        } else if (target === 'text') {
          var t = textOf(s);
          var size = p.size;
          var box = G.Design.textBox(hitCanvas.getContext('2d'), zone, rule, t, size.w, size.h);
          if (!box) return;
          t.x = Math.min(0.95, Math.max(0.05, (box.ax + dx) / size.w));
          t.y = Math.min(0.9, Math.max(0.1, (box.ay + dy) / size.h));
        }
      });
    });

    function end(e) {
      if (!pointers[e.pointerId]) return;
      delete pointers[e.pointerId];
      count = Math.max(0, count - 1);
      if (count > 0 && target === 'pinch') { target = null; pinch = null; return; }
      if (target) {
        el.preview.classList.remove('is-dragging');
        /* One undo entry for the whole gesture, not one per frame. */
        store.commit(function () {});
        syncAll();
      }
      target = null; pinch = null;
    }
    el.preview.addEventListener('pointerup', end);
    el.preview.addEventListener('pointercancel', end);

    var wheelTimer = null;
    el.preview.addEventListener('wheel', function (e) {
      if (mode !== 'flat') return;
      var photo = photoOf(store.get());
      if (!photo || !photo.image) return;
      e.preventDefault();
      var p = zonePoint(e);
      store.touch(function (s) { zoomPhoto(photoOf(s), Math.pow(1.0015, -e.deltaY), p); });
      clearTimeout(wheelTimer);
      wheelTimer = setTimeout(function () { store.commit(function () {}); syncAll(); }, 200);
    }, { passive: false });
  }

  /* ------------------------------------------------------------------ boot */

  function wire() {
    wireTabs();
    wireDrag();
    buildPhotoSliders();
    buildTextSliders();
    buildPlateChips();
    buildColourParts();
    buildPhotoChips();
    buildZonePicker();
    applyZone(zone);

    el.photoInput.addEventListener('change', function (e) {
      if (e.target.files && e.target.files[0]) setPhoto(e.target.files[0]);
      e.target.value = '';
    });

    el.removePhoto.addEventListener('click', function () {
      store.commit(function (s) { s.zones[zone.id].photo = null; });
      syncAll();
    });

    el.recentre.addEventListener('click', function () {
      store.commit(function (s) {
        var p = photoOf(s);
        if (p && p.moon) G.Photo.placeFeature(p, zone); else if (p) G.Photo.fitCover(p, zone);
      });
      syncAll();
    });
    el.rotateBtn.addEventListener('click', function () {
      store.commit(function (s) { G.Photo.turn(photoOf(s), zone); });
      syncAll();
    });
    el.flipBtn.addEventListener('click', function () {
      store.commit(function (s) { G.Photo.mirror(photoOf(s), zone); });
      syncAll();
    });

    el.moonDate.addEventListener('change', setMoon);
    el.moonTime.addEventListener('change', setMoon);

    el.textInput.addEventListener('input', function () {
      var v = G.Design.applyTextRules(rule, el.textInput.value);
      store.touch(function (s) { textOf(s).value = v; });
      el.charCount.textContent = v.length + '/' + (rule.maxChars || 40);
      growTextBox();
    });
    el.textInput.addEventListener('change', function () { store.commit(function () {}); });
    el.textInput.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      var lines = el.textInput.value.split('\n').length;
      if (lines >= (rule.maxLines || 1)) e.preventDefault();
    });

    [].forEach.call(el.textAlign.children, function (b) {
      b.addEventListener('click', function () {
        store.commit(function (s) { textOf(s).align = b.dataset.align; textOf(s).x = null; });
        syncAll();
      });
    });

    function toggle(btn, key) {
      btn.addEventListener('click', function () {
        var on = btn.getAttribute('aria-pressed') !== 'true';
        store.commit(function (s) { textOf(s)[key] = on; });
        btn.setAttribute('aria-pressed', String(on));
      });
    }
    toggle(el.textCaps, 'caps');
    toggle(el.textOutline, 'outline');
    toggle(el.textShadow, 'shadow');

    el.undoBtn.addEventListener('click', function () { store.undo().then(syncAll); });
    el.redoBtn.addEventListener('click', function () { store.redo().then(syncAll); });

    document.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        (e.shiftKey ? store.redo() : store.undo()).then(syncAll);
      }
    });

    el.priceBreakdownBtn.addEventListener('click', function () {
      var open = el.priceBreakdown.hidden;
      el.priceBreakdown.hidden = !open;
      el.priceBreakdownBtn.setAttribute('aria-expanded', String(open));
    });

    el.addBtn.addEventListener('click', addToCart);

    el.viewTurn.addEventListener('click', function () { setMode('3d', { reveal: true, remember: true }); });
    el.viewFlat.addEventListener('click', function () { setMode('flat', { remember: true }); });

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

  function markSeg(align) {
    [].forEach.call(el.textAlign.children, function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.align === align));
    });
  }

  function growTextBox() {
    var rows = Math.min(rule.maxLines || 1, el.textInput.value.split('\n').length);
    el.textInput.rows = Math.max(1, rows);
  }

  function syncAll() {
    var s = store.get();
    syncPhotoControls();
    syncMoon();

    var t = Object.assign({}, G.Design.TEXT_DEFAULTS, textOf(s) || {});
    el.textInput.value = t.value || '';
    growTextBox();
    el.charCount.textContent = (t.value || '').length + '/' + (rule.maxChars || 40);
    markSeg(t.align || 'center');
    el.textCaps.setAttribute('aria-pressed', String(!!t.caps));
    el.textOutline.setAttribute('aria-pressed', String(!!t.outline));
    el.textShadow.setAttribute('aria-pressed', String(!!t.shadow));
    markChips(el.textPlates, 'plate', t.plate || 'none');
    [].forEach.call(el.fontChips.children, function (c) {
      c.setAttribute('aria-pressed', String(c.dataset.font === t.font));
    });
    markSwatch(el.textColours, t.color);
    markSwatch(el.textColours2, t.color2 || 'NONE');

    sliders.forEach(function (h) { h.sync(s); });

    /* Undo changes the design, so every control has to follow it back. A stale
       swatch that still looks selected after an undo is a lie about the state. */
    [].forEach.call(el.colourParts.querySelectorAll('[data-part]'), function (wrap) {
      markSwatch(wrap.querySelector('.cz-swatches'), s.colors[wrap.dataset.part]);
    });
    [].forEach.call(el.colourParts.querySelectorAll('[data-fill-zone]'), function (wrap) {
      var z = s.zones[wrap.dataset.fillZone];
      markSwatch(wrap.querySelector('[data-role="fill"]'), z.fill || 'NONE');
      markSwatch(wrap.querySelector('[data-role="fill2"]'), z.fill2 || 'NONE');
      markChips(wrap.querySelector('[data-role="pattern"]'), 'pattern', z.pattern || 'none');
    });
  }

  function fail(message) {
    el.loading.textContent = message;
    el.loading.hidden = false;
  }

  /* ---------------------------------------------------------- what to open

     Four ways in, and the URL decides which. A template, a cart item or a
     date from the moon page wins over the autosave and clears it, because
     the link is what says which design this screen is showing and a refresh
     has to land on the same one. */

  function fromTemplate(tpl) {
    var state = G.Recipe.initialState(recipe);
    var src = tpl.state || {};

    Object.keys(src.colors || {}).forEach(function (k) {
      if (k in state.colors) state.colors[k] = src.colors[k];
    });

    Object.keys(src.zones || {}).forEach(function (id) {
      if (!state.zones[id]) return;
      var from = src.zones[id], into = state.zones[id];
      if (from.fill) into.fill = from.fill;
      if (from.fill2) into.fill2 = from.fill2;
      if (from.pattern) into.pattern = from.pattern;
      if (from.photo && from.photo.moon) into.photo = Object.assign({}, from.photo);
      if (!from.text) return;
      Object.keys(from.text).forEach(function (k) {
        if (from.text[k] != null) into.text[k] = from.text[k];
      });
      var zrule = (recipe.textRules || []).filter(function (r) { return r.zoneId === id; })[0] || {};
      into.text.value = G.Design.applyTextRules(zrule, into.text.value);
    });

    /* The moon of a template's date is drawn by the same path a saved design
       takes, so the template is a snapshot like any other. */
    return G.State.hydrate(G.State.snapshot(state), recipe);
  }

  function openWith(params) {
    if (params.cartId) {
      var item = G.Cart.find(params.cartId);
      if (item) {
        editingId = item.id;
        el.addBtn.textContent = 'Update the cart';
        store.clearSaved();
        return G.State.hydrate(item.snapshot, recipe).then(function (s) { store.replace(s); });
      }
    }

    if (params.templateId) {
      return G.Data.doc('templates/' + params.templateId)
        .then(function (tpl) {
          if (!tpl || tpl.productId !== recipe.id) return;
          store.clearSaved();
          return fromTemplate(tpl).then(function (s) { store.replace(s); });
        })
        .catch(function () { /* a missing template opens a blank one, not an error */ });
    }

    /* The moon page hands over a date. It lands on a blank print with the
       moon of that night already on it. */
    if (params.date) {
      var moonZone = recipe.printZones.filter(function (z) { return (z.accepts || []).indexOf('moon') >= 0; })[0];
      if (moonZone) {
        store.clearSaved();
        var iso = params.date + 'T' + (params.time || '21:00');
        return G.State.moonPhoto(iso, moonZone).then(function (photo) {
          var s = G.Recipe.initialState(recipe);
          s.zones[moonZone.id].photo = photo;
          if (s.zones.caption && s.zones.caption.text) s.zones.caption.text.value = G.State.moonCaption(iso);
          store.replace(s);
        }).catch(function () {});
      }
    }

    var saved = G.State.loadSaved(recipe.id);
    if (G.State.isMeaningful(saved)) {
      return G.State.hydrate(saved, recipe).then(function (s) {
        store.replace(s);
        el.restoredChip.hidden = false;
      });
    }
    return Promise.resolve();
  }

  function boot() {
    var q = new URLSearchParams(location.search);
    var id = q.get('p') || 'mug';
    var params = { templateId: q.get('t'), cartId: q.get('c'), date: q.get('date'), time: q.get('time') };

    G.Delivery.load().then(function () {
      paintDeliver();
      setInterval(paintDeliver, 30000);
    }).catch(function () { el.deliverLine.hidden = true; });

    G.Recipe.load(id)
      .then(function (r) {
        recipe = r;
        document.title = 'Make your ' + r.name.toLowerCase() + '. Gifty';
        el.productName.textContent = r.name;
        el.loading.textContent = 'Getting the ' + r.name.toLowerCase() + ' ready';
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

        store = G.State.create(G.Recipe.initialState(recipe), onChange);
        wire();

        return openWith(params).then(syncAll);
      })
      .then(function () {
        el.loading.hidden = true;

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

        el.preview.classList.add('is-first');
        el.preview3d.classList.add('is-first');
        G.Render.draw(el.preview, recipe, cache, images, store.get(), 1);
        setMode(opening);
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            el.preview.classList.add('is-ready');
            el.preview3d.classList.add('is-ready');
            if (opening === '3d' && scene) {
              try { scene.reveal(); } catch (e) { dropScene(e); }
            }
          });
        });
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
