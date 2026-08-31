/* Gifty engine. Surface warping.
 *
 * There is exactly ONE warp in this engine: a per pixel gather. Every product
 * surface, curved or flat, is expressed as a uv map, which is just "for this
 * screen pixel, which point of the artwork belongs here". A cylinder builds that
 * map from a formula, a flat panel builds it from an inverse bilinear solve, and
 * a photographed surface builds it from an image. All three then feed the same
 * sampler, which is why adding a product never touches this file.
 *
 * The map is built once per zone and cached. Only the gather runs per frame.
 */
(function (G) {
  'use strict';

  var Warp = G.Warp = {};

  /* ---------------------------------------------------------------- helpers */

  function cross(ax, ay, bx, by) { return ax * by - ay * bx; }

  /* Solve a point back to (u, v) inside an arbitrary quad.
     Corners are ordered top left, top right, bottom right, bottom left. */
  function inverseBilinear(q, px, py, out) {
    var ax = q[0][0], ay = q[0][1];
    var bx = q[1][0] - ax, by = q[1][1] - ay;
    var cx = q[3][0] - ax, cy = q[3][1] - ay;
    var dx = ax - q[1][0] - q[3][0] + q[2][0];
    var dy = ay - q[1][1] - q[3][1] + q[2][1];
    var ex = px - ax, ey = py - ay;

    var A = -cross(dx, dy, cx, cy);
    var B = cross(dx, dy, ex, ey) - cross(bx, by, cx, cy);
    var C = cross(bx, by, ex, ey);

    var v;
    if (Math.abs(A) < 1e-9) {
      if (Math.abs(B) < 1e-12) return false;
      v = -C / B;
    } else {
      var disc = B * B - 4 * A * C;
      if (disc < 0) return false;
      var sq = Math.sqrt(disc);
      v = (-B - sq) / (2 * A);
      if (v < 0 || v > 1) v = (-B + sq) / (2 * A);
    }

    var denX = bx + dx * v, denY = by + dy * v;
    var u = Math.abs(denX) > Math.abs(denY)
      ? (ex - cx * v) / denX
      : (ey - cy * v) / denY;

    out[0] = u; out[1] = v;
    return true;
  }

  /* ------------------------------------------------------- uv map generators
     Each returns uv for one screen point, or false when the point is off the
     surface. Adding a surface kind means adding one function here, which is an
     engine change, so the five launch products deliberately reuse these three. */

  var SURFACES = {

    /* A vertical axis cylinder seen straight on. The artwork wraps wrapDeg of
       the circumference, we see the front half, and a horizontal band on the
       cylinder dips toward the viewer at the centre by bowPx, which is what
       stops a mug print from looking like a sticker on a rectangle. */
    cylinder: function (zone) {
      var r = zone.rect;
      var cx = r.x + r.w / 2;
      var R = r.w / 2;
      var wrapRad = (zone.warp.wrapDeg || 180) * Math.PI / 180;
      var bow = zone.warp.bowPx || 0;
      return function (sx, sy, out) {
        var dx = (sx - cx) / R;
        if (dx <= -1 || dx >= 1) return false;
        var u = 0.5 + Math.asin(dx) / wrapRad;
        if (u < 0 || u > 1) return false;
        var top = r.y + bow * Math.sqrt(1 - dx * dx);
        var v = (sy - top) / r.h;
        if (v < 0 || v > 1) return false;
        out[0] = u; out[1] = v;
        return true;
      };
    },

    /* A flat panel under perspective. Cheaper than the cylinder and, per the
       brief, good enough for tote, cap panel and frame. */
    quad: function (zone) {
      var q = zone.warp.quad;
      return function (sx, sy, out) {
        if (!inverseBilinear(q, sx, sy, out)) return false;
        return out[0] >= 0 && out[0] <= 1 && out[1] >= 0 && out[1] <= 1;
      };
    },

    /* A displacement map baked from a real photograph. Red carries u, green
       carries v, alpha marks the printable region. "gray" treats the single
       channel as u and runs v linearly, which is the classic depth map the
       brief describes. This is the path a real product shot will use. */
    map: function (zone, ctx) {
      var img = ctx.images[zone.warp.url];
      var c = document.createElement('canvas');
      c.width = img.naturalWidth || img.width;
      c.height = img.naturalHeight || img.height;
      c.getContext('2d').drawImage(img, 0, 0);
      var data = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      var mw = c.width, mh = c.height;
      var r = zone.rect;
      var gray = zone.warp.channels === 'gray';
      return function (sx, sy, out) {
        var mx = Math.round((sx - r.x) / r.w * (mw - 1));
        var my = Math.round((sy - r.y) / r.h * (mh - 1));
        if (mx < 0 || my < 0 || mx >= mw || my >= mh) return false;
        var i = (my * mw + mx) * 4;
        if (data[i + 3] < 8) return false;
        out[0] = data[i] / 255;
        out[1] = gray ? (sy - r.y) / r.h : data[i + 1] / 255;
        return true;
      };
    }
  };

  /* ------------------------------------------------------------- build a map
     Coverage is supersampled 2x2 at build time and baked into the map, so the
     silhouette edge is soft without costing anything per frame. Without it the
     left and right edges of a mug wrap crawl with jaggies. */

  Warp.build = function (zone, ctx) {
    var make = SURFACES[zone.warp.type];
    if (!make) throw new Error('unknown surface type: ' + zone.warp.type);
    var at = make(zone, ctx || { images: {} });

    var r = zone.rect;
    var pad = Math.ceil((zone.warp.bowPx || 0)) + 2;
    var x0 = Math.floor(r.x) - 1;
    var y0 = Math.floor(r.y) - 1;
    var w = Math.ceil(r.w) + 2;
    var h = Math.ceil(r.h) + pad;

    var uv = new Float32Array(w * h * 2);
    var cov = new Float32Array(w * h);
    var out = [0, 0];
    var OFF = [0.25, 0.75];

    for (var py = 0; py < h; py++) {
      for (var px = 0; px < w; px++) {
        var i = py * w + px;
        var hits = 0, su = 0, sv = 0;
        for (var a = 0; a < 2; a++) {
          for (var b = 0; b < 2; b++) {
            if (at(x0 + px + OFF[a], y0 + py + OFF[b], out)) {
              hits++; su += out[0]; sv += out[1];
            }
          }
        }
        if (!hits) continue;
        cov[i] = hits / 4;
        uv[i * 2] = su / hits;
        uv[i * 2 + 1] = sv / hits;
      }
    }
    return { x: x0, y: y0, w: w, h: h, uv: uv, cov: cov, zoneId: zone.id };
  };

  /* ---------------------------------------------------------------- the gather
     Bilinear, because nearest sampling makes the edges of a warped photo go
     jagged, which the brief calls out specifically. `step` renders every Nth
     pixel and fills the block, which is how the preview keeps up 1:1 with a
     finger during a drag. */

  Warp.gather = function (map, srcData, srcW, srcH, dstData, step) {
    var s = step || 1;
    var uv = map.uv, cov = map.cov, w = map.w, h = map.h;
    var sp = srcData.data, dp = dstData.data;

    for (var py = 0; py < h; py += s) {
      for (var px = 0; px < w; px += s) {
        var i = py * w + px;
        var c = cov[i];
        if (c === 0) continue;

        var fx = uv[i * 2] * (srcW - 1);
        var fy = uv[i * 2 + 1] * (srcH - 1);
        var ix = fx | 0, iy = fy | 0;
        var tx = fx - ix, ty = fy - iy;
        var ix1 = ix + 1 < srcW ? ix + 1 : ix;
        var iy1 = iy + 1 < srcH ? iy + 1 : iy;

        var o00 = (iy * srcW + ix) * 4, o10 = (iy * srcW + ix1) * 4;
        var o01 = (iy1 * srcW + ix) * 4, o11 = (iy1 * srcW + ix1) * 4;
        var w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty);
        var w01 = (1 - tx) * ty, w11 = tx * ty;

        var R = sp[o00] * w00 + sp[o10] * w10 + sp[o01] * w01 + sp[o11] * w11;
        var Gc = sp[o00 + 1] * w00 + sp[o10 + 1] * w10 + sp[o01 + 1] * w01 + sp[o11 + 1] * w11;
        var B = sp[o00 + 2] * w00 + sp[o10 + 2] * w10 + sp[o01 + 2] * w01 + sp[o11 + 2] * w11;
        var A = sp[o00 + 3] * w00 + sp[o10 + 3] * w10 + sp[o01 + 3] * w01 + sp[o11 + 3] * w11;
        A *= c;

        for (var by = 0; by < s && py + by < h; by++) {
          for (var bx = 0; bx < s && px + bx < w; bx++) {
            var d = ((py + by) * w + (px + bx)) * 4;
            dp[d] = R; dp[d + 1] = Gc; dp[d + 2] = B; dp[d + 3] = A;
          }
        }
      }
    }
  };

})(window.Gifty = window.Gifty || {});
