/* Gifty. The hero assembles itself.
 *
 * A blank mug turns into view, then the picture settles onto it and wraps
 * around, then the name types on. It is the real object, drawn by the same
 * engine as the customizer, from the same recipe, lit by the same studio. So
 * what the homepage promises is literally the thing the buyer gets, and it
 * cannot drift from it the way a photograph of a sample can.
 *
 * It is also turnable. Dragging the hero is not a feature anybody asks for; it
 * is the shortest possible demonstration of the one sentence this whole site is
 * built on, which is that you can see the thing before you buy it.
 *
 * Everything here is opt in and late:
 *
 *   - the static illustration in the markup is the real hero. It is never
 *     hidden by a rule. This file only ever replaces it once it has a finished
 *     canvas in hand, so a slow network, an empty catalogue, an old driver or a
 *     thrown error leaves a homepage that looks finished.
 *   - the engine is fetched after load, not with the page, so the homepage's
 *     first paint costs exactly what it cost before this existed.
 *   - reduced motion still gets the object, because a still render is a
 *     photograph and not an animation. It just arrives already assembled and
 *     already at rest.
 *
 * It plays once. Nothing on this page loops in the corner of somebody's eye.
 */
(function (G) {
  'use strict';

  var PARTS = [
    'js/data.js', 'js/recipe.js', 'js/engine/warp.js', 'js/engine/mesh.js',
    'js/engine/design.js', 'js/engine/render.js', 'js/engine/scene.js'
  ];
  var PHOTO = 'assets/samples/puppy.jpg';
  var NAME = 'For Mum';

  function reduced() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function run() {
    var stage = document.querySelector('.stage');
    if (!stage) return;
    if (!G.Scene || !G.Scene.supported()) return flat(stage);

    var recipe, zone, scene, state, canvas;

    G.Recipe.load('mug')
      .then(function (r) {
        recipe = r;
        zone = r.printZones[0];
        return Promise.all([G.Design.ready(), G.Recipe.loadImage(PHOTO)]);
      })
      .then(function (got) {
        var img = got[1];

        /* The canvas goes in FIRST and blank, because the renderer measures its
           own box to size the backing store and an element outside the document
           has no box. It is a finished picture on its own from the first frame:
           a plain white mug, standing on the floor of the same studio. */
        canvas = document.createElement('canvas');
        canvas.className = 'stage__object';
        canvas.tabIndex = 0;
        canvas.setAttribute('role', 'img');
        canvas.setAttribute('aria-label',
          'A white mug. Drag it, or use the arrow keys, to turn it.');
        stage.insertBefore(canvas, stage.firstChild);
        stage.classList.add('is-live');

        scene = G.Scene.create(canvas, recipe);
        if (!scene) {
          canvas.remove();
          stage.classList.remove('is-live');
          return flat(stage);
        }

        state = G.Recipe.initialState(recipe);
        scene.update(state);

        /* The photo, built by hand rather than through Photo.fromFile, which
           wants a File and an image cache neither of which exist here. Same
           five numbers the renderer reads. */
        var size = G.Design.sizeFor(zone);
        var photo = { image: img, natW: img.naturalWidth, natH: img.naturalHeight, k: 1, ox: 0, oy: 0 };
        photo.k = G.Design.coverScale(photo, size.w, size.h);
        photo.ox = (size.w - photo.natW * photo.k) / 2;
        photo.oy = (size.h - photo.natH * photo.k) / 2;

        var dressed = G.Recipe.initialState(recipe);
        dressed.zones[zone.id].photo = photo;
        dressed.zones[zone.id].text.font = 'display';
        dressed.zones[zone.id].text.color = '#FFFFFF';
        dressed.zones[zone.id].text.size = 0.16;
        dressed.zones[zone.id].text.y = 0.78;

        /* Redrawn whenever the canvas changes size, or the mug is framed for a
           box it no longer has. Passive, and it never turns anything. */
        window.addEventListener('resize', function () { scene.resize(); });

        function label(text) {
          canvas.setAttribute('aria-label',
            'A white mug with a photograph of a black puppy printed around it' +
            (text ? ' and the words ' + text + ' underneath' : '') +
            '. Drag it, or use the arrow keys, to turn it.');
        }

        if (reduced()) {
          dressed.zones[zone.id].text.value = NAME;
          scene.update(dressed);
          label(NAME);
          return;
        }

        /* One turn into view, then the picture arrives, then the name types on.
           Three beats, and each one says something a caption would have to:
           this turns, this takes your photo, this takes your words. */
        scene.reveal();
        setTimeout(function () {
          scene.update(dressed);
          label('');
          var i = 0;
          (function step() {
            i++;
            dressed.zones[zone.id].text.value = NAME.slice(0, i);
            scene.update(dressed);
            if (i < NAME.length) setTimeout(step, 78);
            else label(NAME);
          })();
        }, 1180);
      })
      .catch(function () {
        /* The illustration in the markup is still there and still finished. */
      });
  }

  /* No WebGL. The flat renderer still draws a finished mug with the photo and
     the name on it, which is the same promise made with one less dimension. */
  function flat(stage) {
    var recipe, images, cache, view;

    G.Recipe.load('mug')
      .then(function (r) {
        recipe = r;
        return G.Recipe.loadImages(r);
      })
      .then(function (imgs) {
        images = imgs;
        return Promise.all([G.Design.ready(), G.Recipe.loadImage(PHOTO)]);
      })
      .then(function (got) {
        var img = got[1];
        var zone = recipe.printZones[0];
        cache = G.Render.prepare(recipe, images);
        view = recipe.views[0];

        var out = { w: 720, h: Math.round(720 * view.h / view.w) };
        var scratch = document.createElement('canvas');
        scratch.width = view.w; scratch.height = view.h;
        var full = document.createElement('canvas');
        full.width = out.w; full.height = out.h;
        var ctx = full.getContext('2d');

        var size = G.Design.sizeFor(zone);
        var photo = { image: img, natW: img.naturalWidth, natH: img.naturalHeight, k: 1, ox: 0, oy: 0 };
        photo.k = G.Design.coverScale(photo, size.w, size.h);
        photo.ox = (size.w - photo.natW * photo.k) / 2;
        photo.oy = (size.h - photo.natH * photo.k) / 2;

        var dressed = G.Recipe.initialState(recipe);
        dressed.zones[zone.id].photo = photo;
        dressed.zones[zone.id].text.font = 'display';
        dressed.zones[zone.id].text.color = '#FFFFFF';
        dressed.zones[zone.id].text.size = 0.16;
        dressed.zones[zone.id].text.y = 0.78;
        dressed.zones[zone.id].text.value = NAME;

        G.Render.draw(scratch, recipe, cache, images, dressed, 1);
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(scratch, 0, 0, out.w, out.h);

        full.className = 'stage__object';
        full.setAttribute('aria-hidden', 'true');
        stage.insertBefore(full, stage.firstChild);
        stage.classList.add('is-live');
        stage.setAttribute('aria-label',
          'A white mug with a photograph of a black puppy printed around it and the words ' + NAME + ' underneath');
      })
      .catch(function () {});
  }

  function start() {
    if (!document.querySelector('.stage')) return;
    G.Engine.need(PARTS).then(run).catch(function () {});
  }

  /* After load, so the hero costs the homepage nothing it was not already
     paying. requestIdleCallback where there is one, a timeout where there is
     not, because Safari only shipped it in 2023. */
  function queue() {
    if (window.requestIdleCallback) requestIdleCallback(start, { timeout: 2000 });
    else setTimeout(start, 400);
  }

  if (document.readyState === 'complete') queue();
  else window.addEventListener('load', queue);

})(window.Gifty = window.Gifty || {});
