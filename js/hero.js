/* Gifty. The hero assembles itself.
 *
 * A blank mug, then the picture settles onto it and wraps, then the name types
 * on. It is a live render by the same engine that draws the customizer, so what
 * the homepage promises is literally the thing the buyer gets, and it cannot
 * drift from it.
 *
 * Everything here is opt in and late:
 *
 *   - the static illustration in the markup is the real hero. It is never
 *     hidden by a rule. This file only ever replaces it once it has a finished
 *     canvas in hand, so a slow network, an empty catalogue or a thrown error
 *     leaves a homepage that looks finished.
 *   - the engine is fetched after load, not with the page, so the homepage's
 *     first paint costs exactly what it cost before this existed.
 *   - reduced motion never gets here at all.
 *
 * It plays once. Nothing on this page loops in the corner of somebody's eye.
 */
(function (G) {
  'use strict';

  var VERSION = (document.querySelector('meta[name="version"]') || {}).content || '';
  var PARTS = ['js/data.js', 'js/recipe.js', 'js/engine/warp.js', 'js/engine/design.js', 'js/engine/render.js'];
  var PHOTO = 'assets/hero/photo.svg';
  var NAME = 'For Mum';

  function reduced() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /* The five files are plain script tag IIFEs and they depend on each other in
     order, so they are chained rather than fired off together. */
  function load(list) {
    return list.reduce(function (chain, src) {
      return chain.then(function () {
        return new Promise(function (resolve, reject) {
          var s = document.createElement('script');
          s.src = src + (VERSION ? '?v=' + VERSION : '');
          s.onload = resolve;
          s.onerror = function () { reject(new Error(src)); };
          document.head.appendChild(s);
        });
      });
    }, Promise.resolve());
  }

  function canvasOf(w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  function run() {
    var stage = document.querySelector('.stage');
    if (!stage) return;

    var recipe, images, cache, zone, scratch, base, full, view, ctxBase, ctxFull;
    var out = { w: 720, h: 560 };

    G.Recipe.load('mug')
      .then(function (r) {
        recipe = r;
        zone = r.printZones[0];
        return G.Recipe.loadImages(r);
      })
      .then(function (imgs) {
        images = imgs;
        return Promise.all([G.Design.ready(), G.Recipe.loadImage(PHOTO)]);
      })
      .then(function (got) {
        var img = got[1];
        cache = G.Render.prepare(recipe, images);
        view = recipe.views[0];

        out.h = Math.round(out.w * view.h / view.w);
        scratch = canvasOf(view.w, view.h);
        base = canvasOf(out.w, out.h);
        full = canvasOf(out.w, out.h);
        ctxBase = base.getContext('2d');
        ctxFull = full.getContext('2d');

        /* A photo object built by hand rather than through Photo.fromFile,
           which wants a File and an image cache neither of which exist here.
           Same five numbers the renderer reads. */
        var size = G.Design.sizeFor(zone);
        var photo = { image: img, natW: img.naturalWidth, natH: img.naturalHeight, k: 1, ox: 0, oy: 0 };
        photo.k = G.Design.coverScale(photo, size.w, size.h);
        photo.ox = (size.w - photo.natW * photo.k) / 2;
        photo.oy = (size.h - photo.natH * photo.k) / 2;

        var blank = G.Recipe.initialState(recipe);
        var dressed = G.Recipe.initialState(recipe);
        dressed.zones[zone.id].photo = photo;
        dressed.zones[zone.id].text.font = 'display';
        dressed.zones[zone.id].text.color = '#FFFFFF';
        dressed.zones[zone.id].text.size = 0.16;
        dressed.zones[zone.id].text.y = 0.78;

        function paint(target, ctx, state) {
          G.Render.draw(scratch, recipe, cache, images, state, 1);
          ctx.clearRect(0, 0, out.w, out.h);
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(scratch, 0, 0, out.w, out.h);
        }

        paint(base, ctxBase, blank);
        paint(full, ctxFull, dressed);

        /* Only now is the static illustration replaced, with two finished
           pictures already drawn. Nothing is ever briefly empty.

           The blank mug goes in first and it is a finished hero on its own. The
           dressed one goes in on top carrying its own keyframes, so the settle
           starts the moment it is in the document rather than waiting on a frame
           callback that a background tab never runs. */
        var art = document.createElement('div');
        art.className = 'stage__art';
        base.className = 'stage__layer';
        full.className = 'stage__layer stage__layer--top';
        base.setAttribute('aria-hidden', 'true');
        full.setAttribute('aria-hidden', 'true');
        art.appendChild(base);
        art.appendChild(full);

        var svg = stage.querySelector('svg');
        if (svg) svg.remove();
        stage.insertBefore(art, stage.firstChild);
        stage.setAttribute('aria-label',
          'A white mug with a picture of a sunset printed around it and the words ' + NAME + ' underneath');

        /* The picture settles onto the mug, then the name types on. */
        setTimeout(function () { type(dressed, paint); }, 760);
      })
      .catch(function () {
        /* The illustration in the markup is still there and still finished. */
      });

    function type(state, paint) {
      var i = 0;
      (function step() {
        i++;
        state.zones[zone.id].text.value = NAME.slice(0, i);
        paint(full, ctxFull, state);
        if (i < NAME.length) setTimeout(step, 74);
      })();
    }
  }

  function start() {
    if (reduced()) return;
    if (!document.querySelector('.stage')) return;
    load(PARTS).then(run).catch(function () {});
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
