/* Gifty engine. Design state, undo, autosave.
 *
 * The design is a plain JSON object plus one decoded image per zone. Everything
 * that is not JSON lives in an image cache keyed by data URL, which is what
 * makes both the undo stack and the autosave trivial: they only ever move JSON.
 *
 * A generated picture, the moon of a date, is the one photo that carries no
 * pixels in the snapshot at all: it carries the date, and is drawn again from
 * it whenever the design is opened, by any page, through the loader below.
 */
(function (G) {
  'use strict';

  var State = G.State = {};

  State.imageCache = {};

  var KEY = 'gifty.design.';
  var LIMIT = 40;

  /* Longest edge kept for the autosaved copy. At the mug's 200mm print width
     this restores at about 228 DPI, comfortably over the 150 DPI gate, so a
     restored design does not quietly become a blurry one. The gate is always
     recomputed from the pixels actually present, never from the original
     upload, so what the buyer is warned about is what will really print. */
  State.AUTOSAVE_MAX_EDGE = 1800;

  /* --------------------------------------------------------------- snapshot */

  /* Every scalar on a photo rides through, so a new option cannot be lost on
     undo or on a reload by being missing from a list here. Only the decoded
     image stays behind, and the autosave copy is left off a generated one. */
  State.snapshot = function (state) {
    var out = { productId: state.productId, colors: {}, zones: {} };
    Object.keys(state.colors || {}).forEach(function (k) { out.colors[k] = state.colors[k]; });
    Object.keys(state.zones || {}).forEach(function (id) {
      var z = state.zones[id];
      var photo = null;
      if (z.photo) {
        photo = {};
        Object.keys(z.photo).forEach(function (k) {
          if (k === 'image') return;
          if (k === 'saveSrc' && z.photo.moon) return;
          photo[k] = z.photo[k];
        });
      }
      out.zones[id] = {
        text: z.text ? JSON.parse(JSON.stringify(z.text)) : null,
        fill: z.fill || null,
        fill2: z.fill2 || null,
        pattern: z.pattern || null,
        photo: photo
      };
    });
    return out;
  };

  /* --------------------------------------------------------------- the moon
     The moon renderer and its ephemeris are fifty kilobytes nobody needs
     until a design carries a date, so they load on first use, from whichever
     page met one. */
  State.moon = function () {
    if (G.Moon) return Promise.resolve(G.Moon);
    if (State._moonLoading) return State._moonLoading;
    var meta = document.querySelector('meta[name="version"]');
    var v = meta ? '?v=' + meta.getAttribute('content') : '';
    function load(src) {
      return new Promise(function (resolve, reject) {
        var s = document.createElement('script');
        s.src = src + v;
        s.onload = resolve;
        s.onerror = function () { reject(new Error('could not load ' + src)); };
        document.head.appendChild(s);
      });
    }
    State._moonLoading = load('js/lunar.js').then(function () { return load('js/engine/moon.js'); })
      .then(function () { return G.Moon; });
    return State._moonLoading;
  };

  /* A photo record for the moon of one moment. The rendered disc is cached
     under an id made from the date, so the same night is drawn once. */
  State.moonPhoto = function (iso, zone) {
    return State.moon().then(function (Moon) {
      var id = 'moon:' + iso;
      var cached = State.imageCache[id];
      var ready = cached ? Promise.resolve(cached) : Moon.render({ date: new Date(iso) });
      return ready.then(function (canvas) {
        State.imageCache[id] = canvas;
        var photo = Object.assign({}, G.Design.PHOTO_DEFAULTS, {
          id: id, image: canvas, natW: canvas.width, natH: canvas.height,
          moon: { iso: iso }, k: 1, ox: 0, oy: 0
        });
        if (zone) G.Photo.placeFeature(photo, zone);
        return photo;
      });
    });
  };

  State.hydrate = function (snap, recipe) {
    var pending = [];
    var state = { productId: snap.productId, colors: {}, zones: {} };
    Object.keys(snap.colors || {}).forEach(function (k) { state.colors[k] = snap.colors[k]; });

    Object.keys(snap.zones || {}).forEach(function (id) {
      var z = snap.zones[id];
      state.zones[id] = {
        text: z.text ? JSON.parse(JSON.stringify(z.text)) : null,
        fill: z.fill || null, fill2: z.fill2 || null, pattern: z.pattern || null,
        photo: null
      };
      if (!z.photo) return;

      if (z.photo.moon && z.photo.moon.iso) {
        var zone = recipe && (recipe.printZones || []).filter(function (pz) { return pz.id === id; })[0];
        pending.push(State.moonPhoto(z.photo.moon.iso, z.photo.k == null ? zone : null).then(function (photo) {
          var keep = Object.assign({}, z.photo);
          delete keep.image;
          state.zones[id].photo = Object.assign(photo, z.photo.k == null ? {} : keep, { image: photo.image });
        }).catch(function () { /* no moon is a blank poster, not a broken page */ }));
        return;
      }

      /* Within a session the full resolution upload is still in the cache, so
         undo costs nothing and loses no pixels. Across sessions only the
         downscaled autosave copy survives, and natW/natH are then taken from
         that copy so the resolution gate reports what will actually print
         rather than what was originally uploaded. */
      var cached = State.imageCache[z.photo.id];
      if (cached) {
        state.zones[id].photo = Object.assign({}, z.photo, { image: cached });
      } else if (z.photo.saveSrc) {
        pending.push(G.Recipe.loadImage(z.photo.saveSrc).then(function (img) {
          State.imageCache[z.photo.id] = img;
          /* The size the design was laid out against, not the file's: a
             quarter turn swaps the two, and the pan and zoom were saved
             against the turned picture. */
          var dims = G.Design.photoDims(img, z.photo.rot || 0);
          /* The zoom was chosen against the upload, and the copy that survives
             a session is smaller than the upload. Left alone, k draws the copy
             at the upload's zoom and a big phone photo lands on the proof and
             the print file at half size, in one corner of the wrap. So k is
             rescaled to keep the drawn size, and the resolution gate then
             reports the copy, which is what will really print. Shipped wrong
             through v0.3.4; the fix is one line and it is this one. */
          var ratio = (z.photo.natW && dims.w) ? z.photo.natW / dims.w : 1;
          state.zones[id].photo = Object.assign({}, z.photo, {
            image: img, natW: dims.w, natH: dims.h, k: z.photo.k * ratio
          });
        }).catch(function () { /* a dropped photo must not take the design with it */ }));
      }
    });

    return pending.length ? Promise.all(pending).then(function () { return state; })
                          : Promise.resolve(state);
  };

  /* ------------------------------------------------------------------ store */

  State.create = function (initial, onChange) {
    var current = initial;
    var past = [];
    var future = [];
    var saveTimer = null;

    /* The design as of the last finished action, which is NOT the same thing as
       the design right now. A drag or a keystroke goes through `touch`, which
       mutates `current` and draws without touching the undo stack; the commit
       that follows then has to push the state from BEFORE all of that. Taking a
       fresh snapshot inside commit pushes the state the buyer is already
       looking at, and undo becomes a button that does nothing, which is what it
       did for typing, every slider and every photo drag. Only discrete changes
       like a colour swatch ever worked. */
    var baseline = State.snapshot(initial);

    function persist() {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(function () {
        try {
          localStorage.setItem(KEY + current.productId, JSON.stringify(State.snapshot(current)));
        } catch (e) {
          /* A full or blocked store must never break the customizer. The design
             stays in memory and the buyer never sees a storage error. */
        }
      }, 400);
    }

    var store = {
      get: function () { return current; },

      /* Live edits during a drag. Not undoable, not saved, just drawn. */
      touch: function (mutate) {
        mutate(current);
        onChange(current, { transient: true });
      },

      /* A finished action. Goes on the undo stack and gets saved. What goes on
         the stack is the baseline, so one gesture is one undo entry however
         many transient frames it took to make. */
      commit: function (mutate) {
        mutate(current);
        past.push(baseline);
        if (past.length > LIMIT) past.shift();
        future.length = 0;
        baseline = State.snapshot(current);
        onChange(current, { transient: false });
        persist();
      },

      canUndo: function () { return past.length > 0; },
      canRedo: function () { return future.length > 0; },

      undo: function () {
        if (!past.length) return Promise.resolve(false);
        var snap = past.pop();
        future.push(baseline);
        return State.hydrate(snap).then(function (s) {
          current = s;
          baseline = State.snapshot(s);
          onChange(current, { transient: false });
          persist();
          return true;
        });
      },

      redo: function () {
        if (!future.length) return Promise.resolve(false);
        var snap = future.pop();
        past.push(baseline);
        return State.hydrate(snap).then(function (s) {
          current = s;
          baseline = State.snapshot(s);
          onChange(current, { transient: false });
          persist();
          return true;
        });
      },

      replace: function (state) {
        current = state;
        baseline = State.snapshot(state);
        past.length = 0;
        future.length = 0;
        onChange(current, { transient: false });
      },

      clearSaved: function () {
        try { localStorage.removeItem(KEY + current.productId); } catch (e) {}
      }
    };

    return store;
  };

  State.loadSaved = function (productId) {
    try {
      var raw = localStorage.getItem(KEY + productId);
      if (!raw) return null;
      var snap = JSON.parse(raw);
      return snap && snap.productId === productId ? snap : null;
    } catch (e) { return null; }
  };

  /* Is there anything in this snapshot worth offering to restore? */
  State.isMeaningful = function (snap) {
    if (!snap) return false;
    var zones = snap.zones || {};
    return Object.keys(zones).some(function (id) {
      var z = zones[id];
      return (z.photo && (z.photo.saveSrc || z.photo.moon)) || z.fill || (z.text && z.text.value && z.text.value.trim());
    });
  };

})(window.Gifty = window.Gifty || {});
