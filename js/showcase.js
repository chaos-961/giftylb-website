/* Gifty. Real objects on the homepage.
 *
 * The product grid used to be six line drawings in six mint squares, which is
 * the visual language of every template on the internet and says nothing about
 * what actually turns up at the door. This replaces each one with a render by
 * the same engine that draws the customizer, carrying a real photograph and a
 * real name, so the picture of the mug on the homepage IS the mug and it cannot
 * drift from the product the way a stock illustration can.
 *
 * The samples are photographs rather than blank objects on purpose. Six white
 * shapes in a row show what we sell; six finished gifts show what you get, and
 * the second is the thing somebody is actually deciding about.
 *
 * Everything about it is opt in and late, for the same three reasons hero.js is
 * written that way:
 *
 *   - the line drawing in the markup is the real tile. It is never hidden by a
 *     rule. A canvas only ever replaces one once a finished picture is in hand,
 *     so a slow network, an old driver or a thrown error leaves the homepage
 *     exactly as it was.
 *   - the engine and the photographs are fetched after load and on idle, so
 *     first paint costs what it cost before this file existed.
 *   - one WebGL context at a time, created and thrown away per product. Six
 *     live contexts is most of a browser's budget for the whole tab, and the
 *     seventh silently kills the first.
 *
 * It is not an animation. Under reduced motion these still render, because a
 * still photograph of a mug is a photograph, not motion.
 */
(function (G) {
  'use strict';

  /* Shared with the hero through G.Engine.need in js/main.js, which remembers
     what it has already started. The two files ask for almost the same list and
     loading data.js twice throws away the catalogue the first copy just
     cached. */
  var PARTS = [
    'js/data.js', 'js/recipe.js', 'js/engine/warp.js', 'js/engine/mesh.js',
    'js/engine/design.js', 'js/engine/render.js', 'js/engine/scene.js'
  ];

  /* Big enough that a tile on a two times display still resolves, small enough
     that six of them are a few milliseconds of fill each. */
  var W = 720, H = 480;

  /* What each product is showing. Every zone named here is one the recipe
     really accepts, and every string is inside that zone's character limit,
     because these go through the same renderer that polices a real order. */
  var SAMPLES = {
    mug: { wrap: { photo: 'assets/samples/puppy.jpg', text: 'For Mum', font: 'display', color: '#FFFFFF', size: 0.15, y: 0.79 } },
    cap: { 'front-panel': { text: 'BEIRUT', font: 'display', color: '#FFFFFF' } },
    bottle: { engrave: { text: 'Rana', font: 'display', color: '#FFFFFF' } },
    tote: { 'front-print': { photo: 'assets/samples/bloom.jpg' } },
    'photo-block': {
      acrylic: { photo: 'assets/samples/coast.jpg' },
      caption: { text: 'Batroun, July', font: 'ui', color: '#FFFFFF' }
    },
    'gift-box': { card: { text: 'Happy birthday, Rana', font: 'hand', color: '#14201F' } }
  };

  /* The scratch canvas has to be in the document and have a real box, because
     the renderer sizes its backing store from getBoundingClientRect. Parked far
     off the top of the page rather than hidden: display none would zero that
     rectangle and visibility hidden costs a paint for nothing. */
  function scratch() {
    var c = document.createElement('canvas');
    c.style.cssText =
      'position:fixed;inset-block-start:-4000px;inset-inline-start:0;' +
      /* base.css caps every canvas at max-inline-size 100%, which on a phone
         clamps this one to the viewport and renders the object into a tall
         narrow frame it was never composed for. */
      'max-inline-size:none;max-block-size:none;' +
      'inline-size:' + W + 'px;block-size:' + H + 'px;pointer-events:none';
    c.setAttribute('aria-hidden', 'true');
    document.body.appendChild(c);
    return c;
  }

  /* The five numbers the renderer reads off a photo, worked out here rather
     than through Photo.fromFile, which wants a File and an image cache neither
     of which exist on this page. Cover, then centre. */
  function place(img, zone) {
    var size = G.Design.sizeFor(zone);
    var p = { image: img, natW: img.naturalWidth, natH: img.naturalHeight, k: 1, ox: 0, oy: 0 };
    p.k = G.Design.coverScale(p, size.w, size.h);
    p.ox = (size.w - p.natW * p.k) / 2;
    p.oy = (size.h - p.natH * p.k) / 2;
    return p;
  }

  function dress(recipe) {
    var plan = SAMPLES[recipe.id] || {};
    var state = G.Recipe.initialState(recipe);
    var wanted = [];

    Object.keys(plan).forEach(function (zoneId) {
      var zone = (recipe.printZones || []).filter(function (z) { return z.id === zoneId; })[0];
      if (!zone) return;
      var want = plan[zoneId];
      var zs = state.zones[zoneId];
      if (!zs) return;

      if (want.text) {
        zs.text.value = want.text;
        if (want.font) zs.text.font = want.font;
        if (want.color) zs.text.color = want.color;
        if (want.size != null) zs.text.size = want.size;
        if (want.y != null) zs.text.y = want.y;
      }
      if (want.photo) {
        wanted.push(G.Recipe.loadImage(want.photo).then(function (img) {
          zs.photo = place(img, zone);
        }).catch(function () { /* the object renders blank, which is still an object */ }));
      }
    });

    return Promise.all(wanted).then(function () { return state; });
  }

  function shoot(id) {
    return G.Recipe.load(id).then(function (recipe) {
      if (!recipe.model) return null;
      return dress(recipe).then(function (state) {
        var gl = scratch();
        var api = null;
        try {
          api = G.Scene.create(gl, recipe);
          if (!api) return null;
          api.update(state);
          api.draw();

          /* Copied into a plain 2D canvas straight away rather than kept as a
             live context. A drawImage off a WebGL canvas is a blit; a data URL
             would be a PNG encode and a megabyte of string per product. */
          var out = document.createElement('canvas');
          out.width = gl.width;
          out.height = gl.height;
          out.getContext('2d').drawImage(gl, 0, 0);
          return out;
        } catch (e) {
          return null;
        } finally {
          if (api) api.destroy();
          gl.remove();
        }
      });
    }).catch(function () { return null; });
  }

  /* One at a time, with a breath between, so six shader compiles do not land in
     one long task on a phone that is still settling the page. */
  function queue(slots, i) {
    if (i >= slots.length) return;
    var slot = slots[i];
    shoot(slot.getAttribute('data-product')).then(function (canvas) {
      if (canvas) {
        canvas.className = 'tile__render';
        canvas.setAttribute('aria-hidden', 'true');
        slot.appendChild(canvas);
        slot.classList.add('is-rendered');
      }
      setTimeout(function () { queue(slots, i + 1); }, 60);
    });
  }

  function start() {
    var slots = document.querySelectorAll('[data-product]');
    if (!slots.length) return;
    if (!G.Scene || !G.Scene.supported || !G.Scene.supported()) return;
    queue(slots, 0);
  }

  function begin() {
    if (!document.querySelector('[data-product]')) return;
    G.Engine.need(PARTS)
      .then(function () { return G.Design.ready(); })
      .then(start)
      .catch(function () { /* the line drawings are still there and still fine */ });
  }

  function idle() {
    if (window.requestIdleCallback) requestIdleCallback(begin, { timeout: 2600 });
    else setTimeout(begin, 600);
  }

  if (document.readyState === 'complete') idle();
  else window.addEventListener('load', idle);

})(window.Gifty = window.Gifty || {});
