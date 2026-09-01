/* Gifty. The proof and the print file.
 *
 * Two images per item, both built from the same design state the customizer
 * drew, by the same engine:
 *
 *   the proof       what the buyer approves. The product, photographed. This
 *                   exact image is stored on the order and shown in the admin
 *                   and on the tracking page, so every side of any argument
 *                   later is looking at one picture.
 *   the print file  what the workshop prints. The flat artwork only, at the
 *                   zone's own minimum DPI, in real millimetres, with the size
 *                   written on it so nobody guesses at the press.
 *
 * No new drawing code. Render.draw and Design.render already do this; here they
 * are just asked for a bigger canvas.
 *
 * Neither is uploaded anywhere. Both are data URLs, and js/order.js splits them
 * across the order's own assets subcollection, because there is no image host
 * and no file bucket on this plan.
 */
(function (G) {
  'use strict';

  var Proof = G.Proof = {};

  var PROOF_WIDTH = 1200;
  var PRINT_MAX_EDGE = 3000;
  var MM_PER_IN = 25.4;

  function canvasOf(w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  /* ------------------------------------------------------------------ proof */

  Proof.proof = function (recipe, cache, images, state) {
    var view = recipe.views[0];
    var full = canvasOf(view.w, view.h);
    G.Render.draw(full, recipe, cache, images, state, 1);

    var out = canvasOf(PROOF_WIDTH, Math.round(PROOF_WIDTH * view.h / view.w));
    var ctx = out.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(full, 0, 0, out.width, out.height);
    return out.toDataURL('image/jpeg', 0.92);
  };

  /* ------------------------------------------------------------- print file

     Every zone that has something in it, stacked, each captioned with the
     millimetres it prints at. A product with two zones makes one file, because
     one file per item is what a workshop can actually keep track of. */

  Proof.printFile = function (recipe, state) {
    var pieces = [];

    (recipe.printZones || []).forEach(function (zone) {
      var zstate = (state.zones && state.zones[zone.id]) || {};
      var hasPhoto = !!(zstate.photo && zstate.photo.image);
      var hasText = !!(zstate.text && zstate.text.value && String(zstate.text.value).trim());
      if (!hasPhoto && !hasText) return;

      var rule = (recipe.textRules || []).filter(function (r) { return r.zoneId === zone.id; })[0] || {};
      var art = G.Design.render({ zone: zone, rule: rule, state: zstate, dpi: zone.minDpi });
      pieces.push({ zone: zone, canvas: art.canvas, w: art.w, h: art.h });
    });

    if (!pieces.length) return null;

    var pad = 40, caption = 54;
    var width = Math.max.apply(null, pieces.map(function (p) { return p.w; })) + pad * 2;
    var height = pad;
    pieces.forEach(function (p) { height += caption + p.h + pad; });

    /* A 300 DPI tote would be enormous and no press needs it from a phone, so
       the whole sheet is scaled down together, keeping every zone in the same
       proportion to every other. */
    var scale = Math.min(1, PRINT_MAX_EDGE / Math.max(width, height));
    var out = canvasOf(Math.round(width * scale), Math.round(height * scale));
    var ctx = out.getContext('2d');
    ctx.scale(scale, scale);

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);

    var y = pad;
    pieces.forEach(function (p) {
      ctx.fillStyle = '#14201F';
      ctx.font = '600 26px Inter, system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(
        (p.zone.name || p.zone.id) + '   ' +
        p.zone.widthMm + ' x ' + p.zone.heightMm + ' mm   ' +
        Math.round(p.w / (p.zone.widthMm / MM_PER_IN)) + ' dpi' +
        (p.zone.bleedMm ? '   bleed ' + p.zone.bleedMm + ' mm' : ''),
        pad, y + 32);
      y += caption;

      /* A hairline round the artwork so the trim edge is unambiguous on paper. */
      ctx.strokeStyle = '#E3EAE8';
      ctx.lineWidth = 2;
      ctx.strokeRect(pad - 1, y - 1, p.w + 2, p.h + 2);
      ctx.drawImage(p.canvas, pad, y);
      y += p.h + pad;
    });

    return out.toDataURL('image/png');
  };

})(window.Gifty = window.Gifty || {});
