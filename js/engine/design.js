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

  /* An @font-face the page never uses is never fetched, so document.fonts.ready
     resolves happily without it. No rule on the shop, the customizer or the
     checkout sets the handwriting face, and a canvas asked for a family it does
     not have falls back without a word. The buyer would approve a proof in the
     wrong lettering and the workshop would print it.

     So ask for every face the renderer can draw, by name, and wait. */
  Design.ready = function () {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    var wanted = Object.keys(FAMILIES).map(function (k) {
      return document.fonts.load('700 40px ' + FAMILIES[k])
        .catch(function () { /* a missing face must not stop the screen */ });
    });
    return Promise.all(wanted).then(function () {});
  };

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

  /* Every option a buyer can set on a line of type, with what a blank design
     gets. Kept here, next to the code that reads them, so a new option cannot
     be drawn without being defaulted and cannot be defaulted without being
     drawn. The customizer, the state snapshot, the templates and the release
     check all name these same keys. */
  Design.TEXT_DEFAULTS = {
    align: 'center',   /* left, center, right */
    spacing: 0,        /* tracking as a fraction of the size, -0.05 to 0.3 */
    caps: false,
    outline: false,    /* a contrasting stroke, so type survives a busy photo */
    shadow: false,
    arc: 0             /* degrees the line bends through; up at the ends when positive */
  };
  Design.PHOTO_DEFAULTS = { rot: 0, flip: false, filter: 'none', shape: 'rect' };
  Design.FILTERS = ['none', 'mono', 'sepia', 'warm', 'cool', 'pop'];
  Design.SHAPES = ['rect', 'soft', 'round', 'heart'];

  /* Width of a string with tracking applied. measureText knows nothing about
     letter spacing in most engines, so the spaced width is added by hand and
     drawing is done the same way, one glyph at a time, so the two agree. */
  function measure(ctx, str, spacing) {
    if (!spacing) return ctx.measureText(str).width;
    var w = 0;
    for (var i = 0; i < str.length; i++) w += ctx.measureText(str[i]).width;
    return w + spacing * Math.max(0, str.length - 1);
  }

  function wrapLine(ctx, text, maxW, maxLines, spacing) {
    var words = String(text).split(/[ \t]+/).filter(Boolean);
    var lines = [], line = '';
    for (var i = 0; i < words.length; i++) {
      var test = line ? line + ' ' + words[i] : words[i];
      if (measure(ctx, test, spacing) <= maxW || !line) {
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

  /* A typed line break is a line the buyer asked for, so it is honoured before
     any wrapping happens, and the cap on lines counts both kinds. */
  function wrap(ctx, text, maxW, maxLines, spacing) {
    var out = [];
    String(text).split('\n').forEach(function (para) {
      if (out.length >= maxLines) return;
      if (!para.trim()) return;
      var got = wrapLine(ctx, para, maxW, maxLines - out.length, spacing);
      out = out.concat(got);
    });
    return out.slice(0, maxLines);
  }

  Design.applyTextRules = function (rule, text) {
    var t = String(text == null ? '' : text);
    if (rule && rule.maxChars) t = t.slice(0, rule.maxChars);
    return t;
  };

  /* Type that has to sit on a photograph needs an edge. Dark type takes a
     white one and light type takes an ink one, chosen from the colour rather
     than asked for, because "outline colour" is one control too many. */
  function contrastOf(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
    if (!m) return '#FFFFFF';
    var n = parseInt(m[1], 16);
    var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    var luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    return luma > 0.55 ? '#14201F' : '#FFFFFF';
  }

  /* One line of glyphs, straight or on an arc, with or without tracking. The
     paint callback draws one glyph or one whole string at the current origin,
     so the engraved two pass version and the plain one share every line of
     placement code. */
  function paintLine(ctx, str, x, y, opts, paint) {
    var spacing = opts.spacing, arc = opts.arc;
    if (!spacing && !arc) { paint(str, x, y); return; }

    var widths = [], total = 0;
    for (var i = 0; i < str.length; i++) {
      widths[i] = ctx.measureText(str[i]).width;
      total += widths[i];
    }
    total += spacing * Math.max(0, str.length - 1);
    var left = x - total * (opts.align === 'left' ? 0 : opts.align === 'right' ? 1 : 0.5);

    ctx.save();
    ctx.textAlign = 'center';
    if (!arc) {
      var cx = left;
      for (var k = 0; k < str.length; k++) {
        paint(str[k], cx + widths[k] / 2, y);
        cx += widths[k] + spacing;
      }
      ctx.restore();
      return;
    }

    /* On an arc the line is centred whatever the alignment says, because a
       curve has a middle and a margin does not. */
    var theta = Math.abs(arc) * Math.PI / 180;
    var sgn = arc > 0 ? 1 : -1;
    var R = total / theta;
    var mid = x, run = 0;
    for (var g = 0; g < str.length; g++) {
      var a = ((run + widths[g] / 2) - total / 2) / R;
      var px = mid + R * Math.sin(a);
      var py = y - sgn * R * (1 - Math.cos(a));
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(-sgn * a);
      paint(str[g], 0, 0);
      ctx.restore();
      run += widths[g] + spacing;
    }
    ctx.restore();
  }

  function drawText(ctx, zone, rule, text, w, h) {
    if (!text || !text.value) return;
    var value = Design.applyTextRules(rule, text.value);
    if (!value.trim()) return;
    var t = Object.assign({}, Design.TEXT_DEFAULTS, text);
    if (t.caps) value = value.toUpperCase();

    var fam = FAMILIES[t.font] || FAMILIES[rule.defaultFont] || FAMILIES.ui;
    var px = Math.max(8, (t.size || 0.2) * h);
    var weight = t.font === 'display' ? 700 : 600;
    var spacing = (+t.spacing || 0) * px;
    var arc = Math.max(-90, Math.min(90, +t.arc || 0));

    ctx.save();
    ctx.font = weight + ' ' + px + 'px ' + fam;
    ctx.textAlign = t.align === 'left' || t.align === 'right' ? t.align : 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';

    var lines = wrap(ctx, value, w * 0.9, rule.maxLines || 1, spacing);
    var lh = px * 1.12;
    var cy = (t.y == null ? 0.5 : t.y) * h - (lines.length - 1) * lh / 2;
    var x = t.align === 'left' ? w * 0.05 : t.align === 'right' ? w * 0.95 : w / 2;
    var opts = { spacing: spacing, arc: arc, align: ctx.textAlign };

    if (rule.engraved) {
      /* An etch has no colour. It reads as a groove: a dark cut with a lit
         upper lip. Composited over whatever the surface was tinted to. */
      var etch = function (s, gx, gy) { ctx.fillText(s, gx, gy); };
      for (var i = 0; i < lines.length; i++) {
        var y = cy + i * lh;
        ctx.fillStyle = 'rgba(255,255,255,0.34)';
        paintLine(ctx, lines[i], x, y - Math.max(1, px * 0.035), opts, etch);
        ctx.fillStyle = 'rgba(0,0,0,0.46)';
        paintLine(ctx, lines[i], x, y, opts, etch);
      }
    } else {
      var colour = rule.colorLocked ? rule.defaultColor : (t.color || rule.defaultColor);
      ctx.fillStyle = colour;
      ctx.strokeStyle = contrastOf(colour);
      ctx.lineWidth = Math.max(1, px * 0.09);
      if (t.shadow) {
        ctx.shadowColor = 'rgba(0,0,0,0.38)';
        ctx.shadowBlur = px * 0.14;
        ctx.shadowOffsetX = px * 0.03;
        ctx.shadowOffsetY = px * 0.06;
      }
      var paint = t.outline
        ? function (s, gx, gy) { ctx.strokeText(s, gx, gy); ctx.fillText(s, gx, gy); }
        : function (s, gx, gy) { ctx.fillText(s, gx, gy); };
      for (var j = 0; j < lines.length; j++) {
        paintLine(ctx, lines[j], x, cy + j * lh, opts, paint);
      }
    }
    ctx.restore();
  }

  /* ----------------------------------------------------------------- photo

     What is drawn is never the upload itself but a derived copy: turned,
     mirrored and graded as the buyer asked. The copy is made once per
     combination and kept, because a filter is a pass over every pixel of a
     photo that can be eighteen hundred pixels on a side, and a slider on the
     same screen redraws sixty times a second. The key is the photo's id plus
     the three settings, so undo and redo hit the cache too. */

  var derived = {}, derivedOrder = [];
  var DERIVED_KEEP = 8;

  function grade(data, filter) {
    var d = data.data, n = d.length, i, r, g, b, l;
    if (filter === 'mono') {
      for (i = 0; i < n; i += 4) {
        l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        d[i] = d[i + 1] = d[i + 2] = l;
      }
    } else if (filter === 'sepia') {
      for (i = 0; i < n; i += 4) {
        r = d[i]; g = d[i + 1]; b = d[i + 2];
        d[i] = Math.min(255, 0.393 * r + 0.769 * g + 0.189 * b);
        d[i + 1] = Math.min(255, 0.349 * r + 0.686 * g + 0.168 * b);
        d[i + 2] = Math.min(255, 0.272 * r + 0.534 * g + 0.131 * b);
      }
    } else if (filter === 'warm' || filter === 'cool') {
      var kr = filter === 'warm' ? 1.07 : 0.94, kb = filter === 'warm' ? 0.92 : 1.08;
      for (i = 0; i < n; i += 4) {
        d[i] = Math.min(255, d[i] * kr);
        d[i + 2] = Math.min(255, d[i + 2] * kb);
      }
    } else if (filter === 'pop') {
      /* More saturation and a touch more contrast, pivoting on mid grey. */
      for (i = 0; i < n; i += 4) {
        r = d[i]; g = d[i + 1]; b = d[i + 2];
        l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        r = l + (r - l) * 1.4; g = l + (g - l) * 1.4; b = l + (b - l) * 1.4;
        d[i] = Math.max(0, Math.min(255, (r - 128) * 1.12 + 128));
        d[i + 1] = Math.max(0, Math.min(255, (g - 128) * 1.12 + 128));
        d[i + 2] = Math.max(0, Math.min(255, (b - 128) * 1.12 + 128));
      }
    }
    return data;
  }

  /* The natural size of the photo as it will be drawn, which is the upload's
     size with width and height swapped for a quarter turn. Every pan, zoom and
     resolution figure is worked out against this, never against the file. */
  Design.photoDims = function (img, rot) {
    var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    return (rot === 90 || rot === 270) ? { w: h, h: w } : { w: w, h: h };
  };

  Design.photoSource = function (photo) {
    var img = photo.image;
    if (!img) return null;
    var rot = +photo.rot || 0, flip = !!photo.flip, filter = photo.filter || 'none';
    if (!rot && !flip && filter === 'none') return img;

    var key = photo.id + '|' + rot + '|' + flip + '|' + filter;
    if (derived[key]) return derived[key];

    var dims = Design.photoDims(img, rot);
    var c = document.createElement('canvas');
    c.width = dims.w; c.height = dims.h;
    var ctx = c.getContext('2d', { willReadFrequently: filter !== 'none' });
    ctx.translate(dims.w / 2, dims.h / 2);
    ctx.rotate(rot * Math.PI / 180);
    if (flip) ctx.scale(-1, 1);
    var sw = img.naturalWidth || img.width, sh = img.naturalHeight || img.height;
    ctx.drawImage(img, -sw / 2, -sh / 2, sw, sh);
    if (filter !== 'none') {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      try {
        ctx.putImageData(grade(ctx.getImageData(0, 0, dims.w, dims.h), filter), 0, 0);
      } catch (e) { /* a tainted canvas keeps the photo and drops the grade */ }
    }

    derived[key] = c;
    derivedOrder.push(key);
    while (derivedOrder.length > DERIVED_KEEP) delete derived[derivedOrder.shift()];
    return c;
  };

  /* The window the photo shows through. A shape is fitted to the zone's
     shorter side and centred, so a round photo on a mug is the same circle
     whatever the wrap's proportions. */
  function shapePath(ctx, shape, w, h) {
    var s = Math.min(w, h), cx = w / 2, cy = h / 2;
    ctx.beginPath();
    if (shape === 'round') {
      ctx.arc(cx, cy, s * 0.48, 0, Math.PI * 2);
    } else if (shape === 'soft') {
      var r = s * 0.14;
      ctx.moveTo(r, 0); ctx.lineTo(w - r, 0); ctx.arcTo(w, 0, w, r, r);
      ctx.lineTo(w, h - r); ctx.arcTo(w, h, w - r, h, r);
      ctx.lineTo(r, h); ctx.arcTo(0, h, 0, h - r, r);
      ctx.lineTo(0, r); ctx.arcTo(0, 0, r, 0, r);
      ctx.closePath();
    } else if (shape === 'heart') {
      var k = s * 0.5, top = cy - k * 0.72;
      ctx.moveTo(cx, cy + k * 0.86);
      ctx.bezierCurveTo(cx - k * 1.3, cy + k * 0.06, cx - k * 1.06, top - k * 0.42, cx, top + k * 0.22);
      ctx.bezierCurveTo(cx + k * 1.06, top - k * 0.42, cx + k * 1.3, cy + k * 0.06, cx, cy + k * 0.86);
      ctx.closePath();
    } else {
      ctx.rect(0, 0, w, h);
    }
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

    /* A recipe's background is the surface; the buyer's fill sits on top of
       it and under everything else, which is what a coloured ground on a
       white mug is. */
    var ground = state.fill || zone.background;
    if (ground) {
      ctx.fillStyle = ground;
      ctx.fillRect(0, 0, size.w, size.h);
    }

    var photo = state.photo;
    var src = photo && Design.photoSource(photo);
    if (src) {
      ctx.save();
      shapePath(ctx, photo.shape || 'rect', size.w, size.h);
      ctx.clip();
      var dw = photo.natW * photo.k, dh = photo.natH * photo.k;
      ctx.drawImage(src, photo.ox, photo.oy, dw, dh);
      ctx.restore();
    }

    drawText(ctx, zone, rule, state.text, size.w, size.h);

    return { canvas: canvas, w: size.w, h: size.h, ctx: ctx };
  };

})(window.Gifty = window.Gifty || {});
