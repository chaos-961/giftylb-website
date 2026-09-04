/* Gifty engine. The flat artwork.
 *
 * Renders what gets printed, in print space, before any surface warping. The
 * result is a plain rectangle of pixels measured in real millimetres, which is
 * what makes the resolution gate honest and what lets P4 export a print file
 * from the same code path as the preview.
 *
 * Knows nothing about mugs or cylinders. Zone rules arrive from the recipe.
 *
 * Every option a buyer can set is drawn here and nowhere else, so the preview,
 * the proof and the print file cannot disagree about what a slider did.
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

  /* --------------------------------------------------------------- options

     Every option a buyer can set, with what a blank design gets. Kept here,
     next to the code that reads them, so a new option cannot be drawn without
     being defaulted and cannot be defaulted without being drawn. The
     customizer, the state snapshot, the templates and the release check all
     name these same keys, and the release check bounds them by the same
     ranges the sliders offer. */
  Design.TEXT_DEFAULTS = {
    align: 'center',     /* left, center, right */
    x: null,             /* 0.05 to 0.95 across the zone; null means "where align puts it" */
    spacing: 0,          /* tracking as a fraction of the size, -0.05 to 0.3 */
    lineHeight: 1.12,    /* 0.9 to 1.6 */
    weight: null,        /* 300 to 800; null means the face's own weight */
    rotate: 0,           /* degrees, -45 to 45, the whole block */
    opacity: 1,          /* 0.2 to 1 */
    caps: false,
    outline: false,      /* a contrasting stroke, so type survives a busy photo */
    outlineWidth: 0.09,  /* 0.03 to 0.2 of the type size */
    shadow: false,
    color2: null,        /* a second colour makes a top to bottom gradient */
    plate: 'none',       /* none, pill, box, line: a ground behind the words */
    arc: 0               /* degrees the line bends through; up at the ends when positive */
  };
  Design.PHOTO_DEFAULTS = {
    rot: 0, flip: false, filter: 'none', shape: 'rect',
    angle: 0,            /* degrees, -45 to 45, free rotation */
    opacity: 1,          /* 0.2 to 1 */
    bright: 0,           /* -0.5 to 0.5 */
    contrast: 0,         /* -0.5 to 0.5 */
    sat: 0,              /* -1 to 1 */
    feather: 0,          /* 0 to 1, soft edge */
    border: 0,           /* 0 to 0.12 of the shorter side */
    vignette: 0          /* 0 to 1 */
  };
  Design.FILTERS = ['none', 'mono', 'sepia', 'warm', 'cool', 'pop'];
  Design.SHAPES = ['rect', 'soft', 'round', 'heart', 'arch', 'hex', 'diamond', 'star'];
  Design.PLATES = ['none', 'pill', 'box', 'line'];
  Design.PATTERNS = ['none', 'dots', 'stripes', 'grid', 'rays'];

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
  Design.contrastOf = contrastOf;

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

  /* Where a text block sits and how big it is, in zone pixels, so the
     customizer can hit test a drag against the same numbers that drew it. */
  Design.textBox = function (ctx, zone, rule, text, w, h) {
    if (!text || !text.value) return null;
    var value = Design.applyTextRules(rule, text.value);
    if (!value.trim()) return null;
    var t = Object.assign({}, Design.TEXT_DEFAULTS, text);
    if (t.caps) value = value.toUpperCase();
    var fam = FAMILIES[t.font] || FAMILIES[rule.defaultFont] || FAMILIES.ui;
    var px = Math.max(8, (t.size || 0.2) * h);
    var weight = t.weight || (t.font === 'display' ? 700 : 600);
    var spacing = (+t.spacing || 0) * px;
    ctx.save();
    ctx.font = weight + ' ' + px + 'px ' + fam;
    var lines = wrap(ctx, value, w * 0.9, rule.maxLines || 1, spacing);
    var maxW = 0;
    lines.forEach(function (l) { maxW = Math.max(maxW, measure(ctx, l, spacing)); });
    ctx.restore();
    var lh = px * (t.lineHeight || 1.12);
    var align = t.align === 'left' || t.align === 'right' ? t.align : 'center';
    var ax = (t.x == null ? (align === 'left' ? 0.05 : align === 'right' ? 0.95 : 0.5) : t.x) * w;
    var cy = (t.y == null ? 0.5 : t.y) * h;
    var blockH = (lines.length - 1) * lh + px;
    var left = align === 'left' ? ax : align === 'right' ? ax - maxW : ax - maxW / 2;
    return { x: left, y: cy - blockH / 2, w: maxW, h: blockH, ax: ax, ay: cy,
             px: px, lh: lh, lines: lines, align: align, weight: weight, fam: fam, spacing: spacing, t: t };
  };

  function drawText(ctx, zone, rule, text, w, h) {
    var box = Design.textBox(ctx, zone, rule, text, w, h);
    if (!box) return;
    var t = box.t, lines = box.lines, px = box.px, lh = box.lh;
    var arc = Math.max(-90, Math.min(90, +t.arc || 0));

    ctx.save();
    ctx.font = box.weight + ' ' + px + 'px ' + box.fam;
    ctx.textAlign = box.align;
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = Math.max(0.2, Math.min(1, t.opacity == null ? 1 : +t.opacity));

    /* The block is drawn about its own anchor so a turn turns it in place. */
    ctx.translate(box.ax, box.ay);
    ctx.rotate((+t.rotate || 0) * Math.PI / 180);
    var top = -box.h / 2;
    var left = box.x - box.ax;
    var opts = { spacing: box.spacing, arc: arc, align: box.align };

    if (rule.engraved) {
      /* An etch has no colour. It reads as a groove: a dark cut with a lit
         upper lip. Composited over whatever the surface was tinted to. The
         two passes are strong enough to read on a dark coat, which the
         first version was not. */
      var etch = function (s, gx, gy) { ctx.fillText(s, gx, gy); };
      for (var i = 0; i < lines.length; i++) {
        var y = top + px / 2 + i * lh;
        ctx.fillStyle = 'rgba(255,255,255,0.62)';
        paintLine(ctx, lines[i], 0, y - Math.max(1, px * 0.045), opts, etch);
        ctx.fillStyle = 'rgba(0,0,0,0.58)';
        paintLine(ctx, lines[i], 0, y, opts, etch);
      }
      ctx.restore();
      return;
    }

    var colour = rule.colorLocked ? rule.defaultColor : (t.color || rule.defaultColor);
    var edge = contrastOf(colour);

    /* A ground behind the words: a pill, a box or a rule underneath. It takes
       the contrasting colour so the words always read on it. */
    if (t.plate && t.plate !== 'none') {
      var pad = px * 0.32;
      ctx.fillStyle = edge;
      ctx.globalAlpha *= 0.92;
      if (t.plate === 'line') {
        ctx.fillRect(left - pad * 0.5, box.h / 2 + pad * 0.2, box.w + pad, Math.max(2, px * 0.08));
      } else {
        var r = t.plate === 'pill' ? (box.h + pad * 2) / 2 : px * 0.18;
        roundRect(ctx, left - pad, top - pad, box.w + pad * 2, box.h + pad * 2, r);
        ctx.fill();
      }
      ctx.globalAlpha = Math.max(0.2, Math.min(1, t.opacity == null ? 1 : +t.opacity));
    }

    if (t.color2) {
      var grad = ctx.createLinearGradient(0, top, 0, top + box.h);
      grad.addColorStop(0, colour);
      grad.addColorStop(1, t.color2);
      ctx.fillStyle = grad;
    } else {
      ctx.fillStyle = colour;
    }
    ctx.strokeStyle = edge;
    ctx.lineWidth = Math.max(1, px * (t.outlineWidth == null ? 0.09 : +t.outlineWidth));
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
      paintLine(ctx, lines[j], 0, top + px / 2 + j * lh, opts, paint);
    }
    ctx.restore();
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  /* ----------------------------------------------------------------- photo

     What is drawn is never the upload itself but a derived copy: turned,
     mirrored and graded as the buyer asked. The copy is made once per
     combination and kept, because a grade is a pass over every pixel of a
     photo that can be eighteen hundred pixels on a side, and a slider on the
     same screen redraws sixty times a second. The key is the photo's id plus
     every setting that changes the pixels, so undo and redo hit the cache too.
     While a slider is moving the copy is made at a quarter of the size, which
     keeps the drag smooth; the full one is made when the finger lifts. */

  var derived = {}, derivedOrder = [];
  var DERIVED_KEEP = 10;

  function clamp255(v) { return v < 0 ? 0 : v > 255 ? 255 : v; }

  function grade(data, filter, bright, contrast, sat) {
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
        d[i] = clamp255((r - 128) * 1.12 + 128);
        d[i + 1] = clamp255((g - 128) * 1.12 + 128);
        d[i + 2] = clamp255((b - 128) * 1.12 + 128);
      }
    }
    if (bright || contrast || sat) {
      var add = bright * 255, kc = 1 + contrast * 1.6, ks = 1 + sat;
      for (i = 0; i < n; i += 4) {
        r = d[i]; g = d[i + 1]; b = d[i + 2];
        if (ks !== 1) {
          l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          r = l + (r - l) * ks; g = l + (g - l) * ks; b = l + (b - l) * ks;
        }
        d[i] = clamp255((r - 128) * kc + 128 + add);
        d[i + 1] = clamp255((g - 128) * kc + 128 + add);
        d[i + 2] = clamp255((b - 128) * kc + 128 + add);
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

  function q(v) { return Math.round((+v || 0) * 20) / 20; }

  Design.photoSource = function (photo, quick) {
    var img = photo.image;
    if (!img) return null;
    var rot = +photo.rot || 0, flip = !!photo.flip, filter = photo.filter || 'none';
    var bright = q(photo.bright), contrast = q(photo.contrast), sat = q(photo.sat);
    var graded = filter !== 'none' || bright || contrast || sat;
    if (!rot && !flip && !graded) return img;

    var scale = quick && graded ? 0.5 : 1;
    var key = photo.id + '|' + rot + '|' + flip + '|' + filter + '|' + bright + '|' + contrast + '|' + sat + '|' + scale;
    if (derived[key]) return derived[key];

    var dims = Design.photoDims(img, rot);
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(dims.w * scale));
    c.height = Math.max(1, Math.round(dims.h * scale));
    var ctx = c.getContext('2d', { willReadFrequently: graded });
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate(rot * Math.PI / 180);
    if (flip) ctx.scale(-1, 1);
    var sw = img.naturalWidth || img.width, sh = img.naturalHeight || img.height;
    ctx.drawImage(img, -sw / 2 * scale, -sh / 2 * scale, sw * scale, sh * scale);
    if (graded) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      try {
        ctx.putImageData(grade(ctx.getImageData(0, 0, c.width, c.height), filter, bright, contrast, sat), 0, 0);
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
    var s = Math.min(w, h), cx = w / 2, cy = h / 2, i, a;
    ctx.beginPath();
    if (shape === 'round') {
      ctx.arc(cx, cy, s * 0.48, 0, Math.PI * 2);
    } else if (shape === 'soft') {
      roundRect(ctx, 0, 0, w, h, s * 0.14);
    } else if (shape === 'heart') {
      var k = s * 0.5, top = cy - k * 0.72;
      ctx.moveTo(cx, cy + k * 0.86);
      ctx.bezierCurveTo(cx - k * 1.3, cy + k * 0.06, cx - k * 1.06, top - k * 0.42, cx, top + k * 0.22);
      ctx.bezierCurveTo(cx + k * 1.06, top - k * 0.42, cx + k * 1.3, cy + k * 0.06, cx, cy + k * 0.86);
      ctx.closePath();
    } else if (shape === 'arch') {
      var aw = s * 0.9, ah = Math.min(h, s * 1.15), ax0 = cx - aw / 2, ay0 = cy - ah / 2;
      ctx.moveTo(ax0, ay0 + ah);
      ctx.lineTo(ax0, ay0 + aw / 2);
      ctx.arc(cx, ay0 + aw / 2, aw / 2, Math.PI, 0);
      ctx.lineTo(ax0 + aw, ay0 + ah);
      ctx.closePath();
    } else if (shape === 'hex') {
      for (i = 0; i < 6; i++) {
        a = Math.PI / 6 + i * Math.PI / 3;
        ctx[i ? 'lineTo' : 'moveTo'](cx + s * 0.49 * Math.cos(a), cy + s * 0.49 * Math.sin(a));
      }
      ctx.closePath();
    } else if (shape === 'diamond') {
      ctx.moveTo(cx, cy - s * 0.49); ctx.lineTo(cx + s * 0.49, cy);
      ctx.lineTo(cx, cy + s * 0.49); ctx.lineTo(cx - s * 0.49, cy);
      ctx.closePath();
    } else if (shape === 'star') {
      for (i = 0; i < 10; i++) {
        a = -Math.PI / 2 + i * Math.PI / 5;
        var rr = i % 2 ? s * 0.2 : s * 0.49;
        ctx[i ? 'lineTo' : 'moveTo'](cx + rr * Math.cos(a), cy + rr * Math.sin(a));
      }
      ctx.closePath();
    } else {
      ctx.rect(0, 0, w, h);
    }
  }
  Design.shapePath = shapePath;

  /* The photo layer, drawn on its own canvas so a soft edge, a border and a
     vignette can be applied to the picture alone and then laid down once. */
  var layer = null;

  function drawPhoto(ctx, photo, w, h, quick) {
    var src = Design.photoSource(photo, quick);
    if (!src) return;
    var p = Object.assign({}, Design.PHOTO_DEFAULTS, photo);
    if (!layer) layer = document.createElement('canvas');
    if (layer.width !== w) layer.width = w;
    if (layer.height !== h) layer.height = h;
    var lc = layer.getContext('2d');
    lc.clearRect(0, 0, w, h);

    lc.save();
    shapePath(lc, p.shape, w, h);
    lc.clip();
    var dw = photo.natW * photo.k, dh = photo.natH * photo.k;
    if (p.angle) {
      lc.translate(photo.ox + dw / 2, photo.oy + dh / 2);
      lc.rotate(p.angle * Math.PI / 180);
      lc.drawImage(src, -dw / 2, -dh / 2, dw, dh);
    } else {
      lc.drawImage(src, photo.ox, photo.oy, dw, dh);
    }
    if (p.vignette > 0) {
      var s = Math.max(w, h);
      var vg = lc.createRadialGradient(w / 2, h / 2, s * 0.25, w / 2, h / 2, s * 0.72);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(0,0,0,' + (0.85 * p.vignette).toFixed(3) + ')');
      lc.fillStyle = vg;
      lc.fillRect(0, 0, w, h);
    }
    lc.restore();

    if (p.feather > 0) {
      var m = Math.min(w, h);
      var fg = lc.createRadialGradient(w / 2, h / 2, m * 0.5 * (1 - p.feather) * 0.95, w / 2, h / 2, Math.hypot(w, h) / 2);
      fg.addColorStop(0, 'rgba(0,0,0,1)');
      fg.addColorStop(1, 'rgba(0,0,0,0)');
      lc.save();
      lc.globalCompositeOperation = 'destination-in';
      lc.fillStyle = fg;
      lc.fillRect(0, 0, w, h);
      lc.restore();
    }
    if (p.border > 0) {
      lc.save();
      shapePath(lc, p.shape, w, h);
      lc.clip();
      lc.lineWidth = p.border * Math.min(w, h) * 2;
      lc.strokeStyle = p.borderColor || '#FFFFFF';
      lc.stroke();
      lc.restore();
    }

    ctx.save();
    ctx.globalAlpha = Math.max(0.2, Math.min(1, +p.opacity));
    ctx.drawImage(layer, 0, 0);
    ctx.restore();
  }

  /* ---------------------------------------------------------------- ground */

  function drawGround(ctx, zone, state, w, h) {
    var ground = state.fill || zone.background;
    if (!ground) return;
    if (state.fill && state.fill2) {
      var g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, state.fill);
      g.addColorStop(1, state.fill2);
      ctx.fillStyle = g;
    } else {
      ctx.fillStyle = ground;
    }
    ctx.fillRect(0, 0, w, h);

    var pattern = state.pattern;
    if (!pattern || pattern === 'none') return;
    var ink = contrastOf(state.fill || ground), step = Math.min(w, h) / 9, i;
    ctx.save();
    ctx.globalAlpha = 0.14;
    ctx.fillStyle = ink;
    ctx.strokeStyle = ink;
    ctx.lineWidth = Math.max(1, step * 0.08);
    if (pattern === 'dots') {
      for (var y = step / 2; y < h; y += step) {
        for (var x = step / 2; x < w; x += step) {
          ctx.beginPath(); ctx.arc(x, y, step * 0.11, 0, Math.PI * 2); ctx.fill();
        }
      }
    } else if (pattern === 'stripes') {
      for (i = -h; i < w + h; i += step) {
        ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + h, h); ctx.stroke();
      }
    } else if (pattern === 'grid') {
      for (i = step; i < w; i += step) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, h); ctx.stroke(); }
      for (i = step; i < h; i += step) { ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(w, i); ctx.stroke(); }
    } else if (pattern === 'rays') {
      var R = Math.hypot(w, h);
      for (i = 0; i < 24; i += 2) {
        var a0 = i * Math.PI / 12, a1 = (i + 1) * Math.PI / 12;
        ctx.beginPath(); ctx.moveTo(w / 2, h / 2);
        ctx.arc(w / 2, h / 2, R, a0, a1); ctx.closePath(); ctx.fill();
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

    /* A recipe's background is the surface; the buyer's fill sits on top of
       it and under everything else, which is what a coloured ground on a
       white mug is. */
    drawGround(ctx, zone, state, size.w, size.h);

    if (state.photo && state.photo.image) drawPhoto(ctx, state.photo, size.w, size.h, !!opts.quick);

    drawText(ctx, zone, rule, state.text, size.w, size.h);

    return { canvas: canvas, w: size.w, h: size.h, ctx: ctx };
  };

})(window.Gifty = window.Gifty || {});
