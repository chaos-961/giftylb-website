/* Gifty engine. The flat artwork.
 *
 * Renders what gets printed, in print space, before any surface warping. The
 * result is a plain rectangle of pixels measured in real millimetres, which is
 * what makes the resolution gate honest and what lets P4 export a print file
 * from the same code path as the preview.
 *
 * Knows nothing about mugs or cylinders. Zone rules arrive from the recipe.
 */
(function (G) {
  'use strict';

  var Design = G.Design = {};

  var FAMILIES = {
    display: '"Bricolage Grotesque", system-ui, sans-serif',
    ui: '"Inter", system-ui, sans-serif',
    hand: '"Caveat", cursive'
  };

  Design.families = FAMILIES;

  var MM_PER_IN = 25.4;

  /* Working resolution for the preview. The print file in P4 rebuilds the same
     canvas at the zone's minDpi or better, which is why this is a parameter and
     not a constant sprinkled through the drawing code. */
  Design.PREVIEW_DPI = 110;

  Design.sizeFor = function (zone, dpi) {
    var d = dpi || Design.PREVIEW_DPI;
    return {
      w: Math.max(2, Math.round(zone.widthMm / MM_PER_IN * d)),
      h: Math.max(2, Math.round(zone.heightMm / MM_PER_IN * d))
    };
  };

  /* ------------------------------------------------------- resolution gate
     Effective DPI is how many of the buyer's own pixels land on one printed
     inch. It depends only on the photo's natural size and how far it has been
     zoomed, never on our preview resolution. Under the zone's minDpi we warn
     and show the crop, we never block the order. */

  Design.effectiveDpi = function (zone, photo, canvasW) {
    if (!photo || !photo.natW) return null;
    var pxPerMm = canvasW / zone.widthMm;
    var srcPxPerMm = pxPerMm / photo.k;
    return srcPxPerMm * MM_PER_IN;
  };

  /* Scale that makes the photo exactly cover the zone. */
  Design.coverScale = function (photo, w, h) {
    return Math.max(w / photo.natW, h / photo.natH);
  };

  /* ------------------------------------------------------------------ text */

  function wrap(ctx, text, maxW, maxLines) {
    var words = String(text).split(/\s+/).filter(Boolean);
    var lines = [], line = '';
    for (var i = 0; i < words.length; i++) {
      var test = line ? line + ' ' + words[i] : words[i];
      if (ctx.measureText(test).width <= maxW || !line) {
        line = test;
      } else {
        lines.push(line);
        line = words[i];
        if (lines.length === maxLines) break;
      }
    }
    if (line && lines.length < maxLines) lines.push(line);
    return lines;
  }

  Design.applyTextRules = function (rule, text) {
    var t = String(text == null ? '' : text);
    if (rule && rule.maxChars) t = t.slice(0, rule.maxChars);
    return t;
  };

  function drawText(ctx, zone, rule, text, w, h) {
    if (!text || !text.value) return;
    var value = Design.applyTextRules(rule, text.value);
    if (!value.trim()) return;

    var fam = FAMILIES[text.font] || FAMILIES[rule.defaultFont] || FAMILIES.ui;
    var px = Math.max(8, (text.size || 0.2) * h);
    var weight = text.font === 'display' ? 700 : 600;

    ctx.save();
    ctx.font = weight + ' ' + px + 'px ' + fam;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    var lines = wrap(ctx, value, w * 0.9, rule.maxLines || 1);
    var lh = px * 1.12;
    var cy = (text.y == null ? 0.5 : text.y) * h - (lines.length - 1) * lh / 2;

    if (rule.engraved) {
      /* An etch has no colour. It reads as a groove: a dark cut with a lit
         upper lip. Composited over whatever the surface was tinted to. */
      for (var i = 0; i < lines.length; i++) {
        var y = cy + i * lh;
        ctx.fillStyle = 'rgba(255,255,255,0.34)';
        ctx.fillText(lines[i], w / 2, y - Math.max(1, px * 0.035));
        ctx.fillStyle = 'rgba(0,0,0,0.46)';
        ctx.fillText(lines[i], w / 2, y);
      }
    } else {
      ctx.fillStyle = rule.colorLocked ? rule.defaultColor : (text.color || rule.defaultColor);
      for (var j = 0; j < lines.length; j++) {
        ctx.fillText(lines[j], w / 2, cy + j * lh);
      }
    }
    ctx.restore();
  }

  /* ---------------------------------------------------------------- compose */

  Design.render = function (opts) {
    var zone = opts.zone, rule = opts.rule || {}, state = opts.state || {};
    var size = Design.sizeFor(zone, opts.dpi);
    var canvas = opts.canvas || document.createElement('canvas');
    if (canvas.width !== size.w) canvas.width = size.w;
    if (canvas.height !== size.h) canvas.height = size.h;

    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.clearRect(0, 0, size.w, size.h);

    if (zone.background) {
      ctx.fillStyle = zone.background;
      ctx.fillRect(0, 0, size.w, size.h);
    }

    var photo = state.photo;
    if (photo && photo.image) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, size.w, size.h);
      ctx.clip();
      var dw = photo.natW * photo.k, dh = photo.natH * photo.k;
      ctx.drawImage(photo.image, photo.ox, photo.oy, dw, dh);
      ctx.restore();
    }

    drawText(ctx, zone, rule, state.text, size.w, size.h);

    return { canvas: canvas, w: size.w, h: size.h, ctx: ctx };
  };

})(window.Gifty = window.Gifty || {});
