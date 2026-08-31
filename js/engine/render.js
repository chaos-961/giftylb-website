/* Gifty engine. The compositor.
 *
 * Draws a product view in this order, and this order is the whole trick:
 *
 *   1. the grayscale product photo
 *   2. every colour part, tinted through its mask with mix multiply, so the
 *      real photographic shadows and the specular survive into any hex
 *   3. every print zone: flat artwork, warped onto the surface, then shaded by
 *      the product's own luminance so the print sits ON the object instead of
 *      floating over it
 *   4. a gloss pass with screen, so a dark item still reads as glazed
 *
 * Nothing here knows what a mug is. Every number comes from the recipe. If a
 * product needs a change in this file, the recipe format is wrong, not the file.
 */
(function (G) {
  'use strict';

  var Render = G.Render = {};

  function canvasOf(w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  /* ------------------------------------------------------------------ cache
     Warp maps and the shading lookup are expensive and depend only on the
     recipe, never on the buyer's choices, so they are built once per product. */

  Render.prepare = function (recipe, images) {
    var cache = { views: {}, zones: {} };

    recipe.views.forEach(function (view) {
      var scratch = canvasOf(view.w, view.h);
      cache.views[view.id] = { view: view, scratch: scratch };

      /* Luminance of the untinted product, used to shade the artwork. */
      var bc = canvasOf(view.w, view.h);
      var bctx = bc.getContext('2d', { willReadFrequently: true });
      bctx.drawImage(images[view.baseImage], 0, 0, view.w, view.h);
      cache.views[view.id].baseData = bctx.getImageData(0, 0, view.w, view.h);
    });

    recipe.printZones.forEach(function (zone) {
      var map = G.Warp.build(zone, { images: images });
      var vcache = cache.views[zone.viewId];
      var bd = vcache.baseData.data;
      var vw = vcache.view.w, vh = vcache.view.h;

      /* Bake the surface shading for this zone once. */
      var shade = new Float32Array(map.w * map.h);
      for (var py = 0; py < map.h; py++) {
        for (var px = 0; px < map.w; px++) {
          var sx = map.x + px, sy = map.y + py;
          if (sx < 0 || sy < 0 || sx >= vw || sy >= vh) { shade[py * map.w + px] = 1; continue; }
          var o = (sy * vw + sx) * 4;
          var lum = (0.2126 * bd[o] + 0.7152 * bd[o + 1] + 0.0722 * bd[o + 2]) / 255;
          /* Pull the shading toward 1 so the print keeps its contrast instead
             of being crushed by the darkest part of the cylinder. */
          shade[py * map.w + px] = 0.42 + 0.58 * lum;
        }
      }

      cache.zones[zone.id] = {
        zone: zone,
        map: map,
        shade: shade,
        out: canvasOf(map.w, map.h),
        outData: null,
        designCanvas: document.createElement('canvas')
      };
    });

    return cache;
  };

  /* ---------------------------------------------------------------- drawing */

  function tintParts(ctx, recipe, view, images, cache, state) {
    var scratch = cache.views[view.id].scratch;
    var sctx = scratch.getContext('2d');

    recipe.colorParts.forEach(function (part) {
      if (part.viewId !== view.id) return;
      var hex = (state.colors && state.colors[part.id]) || part.default;
      if (!hex) return;

      sctx.clearRect(0, 0, view.w, view.h);
      sctx.globalCompositeOperation = 'source-over';
      sctx.fillStyle = hex;
      sctx.fillRect(0, 0, view.w, view.h);
      sctx.globalCompositeOperation = 'destination-in';
      sctx.drawImage(images[part.maskUrl], 0, 0, view.w, view.h);

      ctx.globalCompositeOperation = 'multiply';
      ctx.drawImage(scratch, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
    });
  }

  function drawZone(ctx, zc, recipe, state, step) {
    var zone = zc.zone;
    var zstate = (state.zones && state.zones[zone.id]) || {};
    var rule = recipe.textRules.filter(function (r) { return r.zoneId === zone.id; })[0] || {};

    var hasPhoto = !!(zstate.photo && zstate.photo.image);
    var hasText = !!(zstate.text && zstate.text.value && zstate.text.value.trim());
    if (!hasPhoto && !hasText && !zone.background) return;

    var design = G.Design.render({
      zone: zone, rule: rule, state: zstate, canvas: zc.designCanvas
    });
    var srcData = design.ctx.getImageData(0, 0, design.w, design.h);

    var octx = zc.out.getContext('2d', { willReadFrequently: true });
    if (!zc.outData) zc.outData = octx.createImageData(zc.map.w, zc.map.h);
    else zc.outData.data.fill(0);

    G.Warp.gather(zc.map, srcData, design.w, design.h, zc.outData, step);

    /* Shade the warped artwork by the product's own luminance. */
    var dp = zc.outData.data, sh = zc.shade;
    for (var i = 0, n = sh.length; i < n; i++) {
      if (dp[i * 4 + 3] === 0) continue;
      var s = sh[i];
      dp[i * 4] *= s; dp[i * 4 + 1] *= s; dp[i * 4 + 2] *= s;
    }

    octx.putImageData(zc.outData, 0, 0);
    ctx.drawImage(zc.out, zc.map.x, zc.map.y);
  }

  /* `step` of 1 is the settled frame. 2 or 3 is what runs while a finger is
     down, so the preview tracks the drag instead of lagging behind it. */

  Render.draw = function (target, recipe, cache, images, state, step) {
    var view = recipe.views[0];
    var ctx = target.getContext('2d');
    if (target.width !== view.w) { target.width = view.w; target.height = view.h; }

    ctx.clearRect(0, 0, view.w, view.h);
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(images[view.baseImage], 0, 0, view.w, view.h);

    tintParts(ctx, recipe, view, images, cache, state);

    recipe.printZones.forEach(function (zone) {
      if (zone.viewId !== view.id) return;
      drawZone(ctx, cache.zones[zone.id], recipe, state, step);
    });

    if (view.glossImage && images[view.glossImage]) {
      ctx.globalCompositeOperation = view.glossBlend || 'screen';
      ctx.drawImage(images[view.glossImage], 0, 0, view.w, view.h);
      ctx.globalCompositeOperation = 'source-over';
    }
  };

})(window.Gifty = window.Gifty || {});
