/* Gifty engine. Design state, undo, autosave.
 *
 * The design is a plain JSON object plus one decoded image per zone. Everything
 * that is not JSON lives in an image cache keyed by data URL, which is what
 * makes both the undo stack and the autosave trivial: they only ever move JSON.
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

  State.snapshot = function (state) {
    var out = { productId: state.productId, colors: {}, zones: {} };
    Object.keys(state.colors || {}).forEach(function (k) { out.colors[k] = state.colors[k]; });
    Object.keys(state.zones || {}).forEach(function (id) {
      var z = state.zones[id];
      out.zones[id] = {
        text: z.text ? JSON.parse(JSON.stringify(z.text)) : null,
        photo: z.photo ? {
          id: z.photo.id, saveSrc: z.photo.saveSrc,
          natW: z.photo.natW, natH: z.photo.natH,
          k: z.photo.k, ox: z.photo.ox, oy: z.photo.oy
        } : null
      };
    });
    return out;
  };

  State.hydrate = function (snap) {
    var pending = [];
    var state = { productId: snap.productId, colors: {}, zones: {} };
    Object.keys(snap.colors || {}).forEach(function (k) { state.colors[k] = snap.colors[k]; });

    Object.keys(snap.zones || {}).forEach(function (id) {
      var z = snap.zones[id];
      state.zones[id] = { text: z.text ? JSON.parse(JSON.stringify(z.text)) : null, photo: null };
      if (!z.photo) return;

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
          state.zones[id].photo = Object.assign({}, z.photo, {
            image: img, natW: img.naturalWidth, natH: img.naturalHeight
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

      /* A finished action. Goes on the undo stack and gets saved. */
      commit: function (mutate) {
        var before = State.snapshot(current);
        mutate(current);
        past.push(before);
        if (past.length > LIMIT) past.shift();
        future.length = 0;
        onChange(current, { transient: false });
        persist();
      },

      canUndo: function () { return past.length > 0; },
      canRedo: function () { return future.length > 0; },

      undo: function () {
        if (!past.length) return Promise.resolve(false);
        var snap = past.pop();
        future.push(State.snapshot(current));
        return State.hydrate(snap).then(function (s) {
          current = s;
          onChange(current, { transient: false });
          persist();
          return true;
        });
      },

      redo: function () {
        if (!future.length) return Promise.resolve(false);
        var snap = future.pop();
        past.push(State.snapshot(current));
        return State.hydrate(snap).then(function (s) {
          current = s;
          onChange(current, { transient: false });
          persist();
          return true;
        });
      },

      replace: function (state) {
        current = state;
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
      return (z.photo && z.photo.saveSrc) || (z.text && z.text.value && z.text.value.trim());
    });
  };

})(window.Gifty = window.Gifty || {});
