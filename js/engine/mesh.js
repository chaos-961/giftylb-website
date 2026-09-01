/* Gifty engine. Geometry.
 *
 * Builds the real three dimensional shape of a product out of three primitives
 * and nothing else. The same rule as the flat renderer applies here: a product
 * is data. A mug, a cap, a bottle, a tote, a photo block and a gift box are all
 * described by a `model` block in their recipe, and this file has never heard
 * of any of them.
 *
 *   lathe   a 2D profile revolved around the Y axis, optionally through part of
 *           a turn. Mug body, bottle, cap crown, cap brim, lids, rings.
 *   box     a rounded box, built by subdividing a cube and pushing every point
 *           onto the rounded surface. Photo block, tote, gift box.
 *   tube    a circle swept along a 2D path. Mug handle, tote straps, ribbon.
 *
 * Every primitive emits position, normal and uv. The uv convention is the whole
 * trick and it is one sentence: uv runs 0 to 1 across the part of the surface
 * that can be printed, and outside 0 to 1 everywhere else. So the shader never
 * has to know which triangle belongs to a mug wrap and which belongs to a
 * handle. It samples the artwork where uv is inside the print rectangle the
 * recipe named, and does not where it is not.
 */
(function (G) {
  'use strict';

  var Mesh = G.Mesh = {};

  var TAU = Math.PI * 2;

  /* uv for a vertex that is not printable. Anything outside 0..1 works, and -1
     is far enough out that no amount of interpolation drags a neighbour in. */
  var OFF = -1;

  function build(counts) {
    return {
      position: new Float32Array(counts * 3),
      normal: new Float32Array(counts * 3),
      uv: new Float32Array(counts * 2),
      index: [],
      n: 0
    };
  }

  function finish(m) {
    var Index = m.n > 65535 ? Uint32Array : Uint16Array;
    return {
      position: m.position,
      normal: m.normal,
      uv: m.uv,
      index: new Index(m.index),
      count: m.index.length
    };
  }

  /* Stitch a rows by cols grid of vertices into triangles.

     Winding is load bearing. The renderer culls back faces, which is what stops
     the underside of a mug fighting its own silhouette for the same pixels, so
     every triangle in this file has to come out counterclockwise seen from
     outside the material. `flip` is for the grids whose two axes happen to be
     ordered the other way round. */
  function grid(m, base, rows, cols, flip) {
    for (var r = 0; r < rows - 1; r++) {
      for (var c = 0; c < cols - 1; c++) {
        var a = base + r * cols + c;
        var b = a + 1;
        var d = a + cols;
        var e = d + 1;
        if (flip) m.index.push(a, d, b, b, d, e);
        else m.index.push(a, b, d, b, e, d);
      }
    }
  }

  function put(m, i, px, py, pz, nx, ny, nz, u, v) {
    m.position[i * 3] = px; m.position[i * 3 + 1] = py; m.position[i * 3 + 2] = pz;
    m.normal[i * 3] = nx; m.normal[i * 3 + 1] = ny; m.normal[i * 3 + 2] = nz;
    m.uv[i * 2] = u; m.uv[i * 2 + 1] = v;
  }

  /* --------------------------------------------------------------- 1. lathe

     `profile` is a list of [radius, y] read bottom to top. `printSpan` names the
     two profile indices the artwork lives between, and v is measured as real
     arc length between them, so a print does not stretch where the profile
     curves. Points outside the span get v out of range and are never printed on.

     v is 0 at the END of the span and 1 at the start, which is not arbitrary: a
     profile is authored bottom to top and an image has its first row at the
     top. Measuring v the other way puts every photo on every mug upside down.

     Angles are measured from the front of the object, which is +Z, turning
     toward +X. u is 0.5 at the front, which is what makes a print rectangle in
     the recipe read the way a person would say it: centred means centred.

     Trace the cross section anticlockwise with radius to the right and y up,
     so the material is always on the left of travel. The surface normal is the
     tangent turned a quarter turn to the right, so tracing it the other way
     round lights the part inside out and the renderer culls it away. A mug goes
     out along the bottom, up the outside, over the rim and back down the
     inside, and that closed loop is why it can be culled at all. */

  Mesh.lathe = function (spec) {
    var profile = spec.profile;
    var segments = spec.segments || 96;
    var arcDeg = spec.arcDeg == null ? 360 : spec.arcDeg;
    var arcMid = (spec.arcMidDeg || 0) * Math.PI / 180;
    var span = spec.printSpan;

    var arc = arcDeg * Math.PI / 180;
    var cols = segments + 1;
    var rows = profile.length;

    /* Arc length along the profile, used for v and for the normals. */
    var len = [0];
    for (var i = 1; i < rows; i++) {
      var dr = profile[i][0] - profile[i - 1][0];
      var dy = profile[i][1] - profile[i - 1][1];
      len[i] = len[i - 1] + Math.sqrt(dr * dr + dy * dy);
    }

    var v0 = span ? len[span[0]] : 0;
    var v1 = span ? len[span[1]] : len[rows - 1];
    var vSpan = (v1 - v0) || 1;

    var m = build(rows * cols);
    var k = 0;

    for (var r = 0; r < rows; r++) {
      var rad = profile[r][0];
      var y = profile[r][1];

      /* The profile tangent, central differenced so a corner reads as a corner
         and a curve reads as a curve. The surface normal is that tangent turned
         a quarter turn inside the profile plane. */
      var a = profile[Math.max(0, r - 1)];
      var b = profile[Math.min(rows - 1, r + 1)];
      var tr = b[0] - a[0], ty = b[1] - a[1];
      var tl = Math.sqrt(tr * tr + ty * ty) || 1;
      var nr = ty / tl, ny = -tr / tl;

      /* v is inside 0..1 only across the printable span. */
      var v = span
        ? (r < span[0] || r > span[1] ? OFF : (v1 - len[r]) / vSpan)
        : (v1 - len[r]) / vSpan;

      for (var c = 0; c < cols; c++) {
        var t = c / segments;
        var theta = arcMid + (t - 0.5) * arc;
        var s = Math.sin(theta), co = Math.cos(theta);
        put(m, k++,
            rad * s, y, rad * co,
            nr * s, ny, nr * co,
            0.5 + theta / TAU, v);
      }
    }

    m.n = k;
    grid(m, 0, rows, cols);
    return finish(m);
  };

  /* ----------------------------------------------------------------- 2. box

     A rounded box, and the rounding is the reason it is built this way. Take a
     point on a sharp cube, clamp it into the box shrunk by the corner radius,
     and push it back out by that radius along the direction between the two.
     A face centre does not move, an edge sweeps a quarter round, a corner
     sweeps an eighth of a sphere, and the direction that pushed it out IS the
     surface normal. One formula, correct everywhere, no special cases.

     The grid along each axis is not uniform: it spends samples on the rounded
     part in equal angles and crosses the flat part in a few big steps, because
     a uniform grid puts one vertex in the whole corner and it shows.

     `printFace` names the one face the artwork sits on, +z by default, and only
     that face gets uv inside 0..1. */

  /* Every row here satisfies u cross v = n. That is the whole reason the table
     is written out rather than derived: it makes the grid come out
     counterclockwise seen from outside on all six faces at once, so the box
     needs no per face winding flip and can be culled like everything else.
     Get one row wrong and that face turns inside out and vanishes. */
  var FACES = [
    { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], id: '+z' },
    { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0], id: '-z' },
    { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0], id: '+x' },
    { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0], id: '-x' },
    { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1], id: '+y' },
    { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1], id: '-y' }
  ];

  /* Sample coordinates along one axis: an arc's worth at each end, a straight
     run across the middle. Returns values from -half to half. */
  function axisSamples(half, radius, arcSteps, flatSteps) {
    var flat = Math.max(0, half - radius);
    var out = [];
    var i;
    for (i = 0; i <= arcSteps; i++) {
      out.push(-flat - radius * Math.cos((i / arcSteps) * Math.PI / 2));
    }
    for (i = 1; i < flatSteps; i++) out.push(-flat + (2 * flat) * (i / flatSteps));
    for (i = 0; i <= arcSteps; i++) {
      out.push(flat + radius * Math.cos((Math.PI / 2) * (1 - i / arcSteps)));
    }
    return out;
  }

  Mesh.box = function (spec) {
    var sx = spec.size[0] / 2, sy = spec.size[1] / 2, sz = spec.size[2] / 2;
    var rad = Math.min(spec.bevel == null ? 0.04 : spec.bevel,
                       Math.min(sx, Math.min(sy, sz)) * 0.98);
    var arcSteps = spec.arcSteps || 4;
    var flatSteps = spec.flatSteps || 4;
    var printFace = spec.printFace || '+z';

    var ax = {
      x: axisSamples(sx, rad, arcSteps, flatSteps),
      y: axisSamples(sy, rad, arcSteps, flatSteps),
      z: axisSamples(sz, rad, arcSteps, flatSteps)
    };

    var ix = sx - rad, iy = sy - rad, iz = sz - rad;

    var total = 0;
    var plans = FACES.map(function (f) {
      var uAxis = f.u[0] ? 'x' : (f.u[1] ? 'y' : 'z');
      var vAxis = f.v[0] ? 'x' : (f.v[1] ? 'y' : 'z');
      var plan = { f: f, uAxis: uAxis, vAxis: vAxis,
                   cols: ax[uAxis].length, rows: ax[vAxis].length };
      total += plan.cols * plan.rows;
      return plan;
    });

    var m = build(total);
    var k = 0;

    plans.forEach(function (p) {
      var f = p.f;
      var base = k;
      var us = ax[p.uAxis], vs = ax[p.vAxis];
      var printable = f.id === printFace;

      for (var r = 0; r < p.rows; r++) {
        for (var c = 0; c < p.cols; c++) {
          /* Where this sample sits on the sharp cube. The sample is a plain
             coordinate along its own axis and the face basis places it, once.
             Signing the sample AND multiplying by the basis cancels out, which
             is how three of these six faces ended up wound inside out. */
          var uu = us[c];
          var vv = vs[r];
          var px = f.n[0] * sx + f.u[0] * uu + f.v[0] * vv;
          var py = f.n[1] * sy + f.u[1] * uu + f.v[1] * vv;
          var pz = f.n[2] * sz + f.u[2] * uu + f.v[2] * vv;

          /* Clamp into the inner box, then push back out by the radius. */
          var qx = Math.max(-ix, Math.min(ix, px));
          var qy = Math.max(-iy, Math.min(iy, py));
          var qz = Math.max(-iz, Math.min(iz, pz));
          var dx = px - qx, dy = py - qy, dz = pz - qz;
          var dl = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
          var nx = dx / dl, ny = dy / dl, nz = dz / dl;

          put(m, k++,
              qx + nx * rad, qy + ny * rad, qz + nz * rad,
              nx, ny, nz,
              /* v is measured back down the face, because the basis above runs
                 v up the object and the first row of an image is its top. */
              printable ? c / (p.cols - 1) : OFF,
              printable ? 1 - r / (p.rows - 1) : OFF);
        }
      }
      grid(m, base, p.rows, p.cols);
    });

    m.n = k;
    return finish(m);
  };

  /* ---------------------------------------------------------------- 3. tube

     A circle swept along a 2D path in the XY plane. The frame is the path
     tangent plus the Z axis, which is all a handle or a strap needs and avoids
     the twisting a general purpose frame introduces on a flat curve. `flatten`
     squashes the ring across Z, which is the difference between a wire handle
     and a strap. Never printable: uv is out of range everywhere. */

  Mesh.tube = function (spec) {
    var path = spec.path;
    var radius = spec.radius || 0.1;
    var ring = spec.ring || 16;
    var flat = spec.flatten == null ? 1 : spec.flatten;

    var rows = path.length, cols = ring + 1;
    var m = build(rows * cols);
    var k = 0;

    for (var r = 0; r < rows; r++) {
      var a = path[Math.max(0, r - 1)];
      var b = path[Math.min(rows - 1, r + 1)];
      var tx = b[0] - a[0], ty = b[1] - a[1];
      var tl = Math.sqrt(tx * tx + ty * ty) || 1;
      tx /= tl; ty /= tl;
      var px = -ty, py = tx;
      var rr = spec.taper
        ? radius * (1 - spec.taper * Math.abs(r / (rows - 1) - 0.5) * 2)
        : radius;

      for (var c = 0; c < cols; c++) {
        var t = c / ring * TAU;
        var cs = Math.cos(t), sn = Math.sin(t);
        var nx = px * cs, ny = py * cs, nz = sn;
        /* The squash scales the position but the normal scales the other way,
           or a flattened strap lights like a round one. */
        var mx = nx, my = ny, mz = nz / flat;
        var ml = Math.sqrt(mx * mx + my * my + mz * mz) || 1;
        put(m, k++,
            path[r][0] + nx * rr, path[r][1] + ny * rr, nz * rr * flat,
            mx / ml, my / ml, mz / ml,
            OFF, OFF);
      }
    }

    m.n = k;
    grid(m, 0, rows, cols);
    return finish(m);
  };

  /* ------------------------------------------------------------ from a recipe

     One part of a model becomes one mesh. Everything else about the part, its
     colour and how shiny it is and which zone prints on it, belongs to the
     renderer and is left alone here. */

  var KINDS = { lathe: Mesh.lathe, box: Mesh.box, tube: Mesh.tube };

  Mesh.fromPart = function (part) {
    var make = KINDS[part.kind];
    if (!make) throw new Error('unknown model part: ' + part.kind);
    var mesh = make(part);

    /* An optional rigid placement, so a lid can be described at the origin and
       then put on top of the box rather than authored in world coordinates. */
    if (part.at || part.scale || part.rotY) {
      var at = part.at || [0, 0, 0];
      var sc = part.scale || [1, 1, 1];
      if (typeof sc === 'number') sc = [sc, sc, sc];
      var ry = (part.rotY || 0) * Math.PI / 180;
      var cs = Math.cos(ry), sn = Math.sin(ry);
      var p = mesh.position, nm = mesh.normal;
      for (var i = 0; i < p.length; i += 3) {
        var x = p[i] * sc[0], y = p[i + 1] * sc[1], z = p[i + 2] * sc[2];
        p[i] = x * cs + z * sn + at[0];
        p[i + 1] = y + at[1];
        p[i + 2] = -x * sn + z * cs + at[2];
        /* A normal transforms by the inverse transpose, which for a diagonal
           scale is one over the scale. Get this wrong and a squashed part
           lights as though it were not squashed. */
        var nx = nm[i] / sc[0], ny = nm[i + 1] / sc[1], nz = nm[i + 2] / sc[2];
        var nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        nx /= nl; ny /= nl; nz /= nl;
        nm[i] = nx * cs + nz * sn;
        nm[i + 1] = ny;
        nm[i + 2] = -nx * sn + nz * cs;
      }
    }

    return mesh;
  };

  /* The bounding box of a whole model, plus the radius of the smallest upright
     cylinder around it. The cylinder is what the camera frames against: the
     view orbits the Y axis, so a box bound shrinks and grows as the object
     turns and the thing clips its own handle halfway through a drag. A
     cylinder is the tightest bound that a Y axis orbit cannot change. */
  Mesh.bounds = function (meshes) {
    var lo = [Infinity, Infinity, Infinity];
    var hi = [-Infinity, -Infinity, -Infinity];
    meshes.forEach(function (mesh) {
      var p = mesh.position;
      for (var i = 0; i < p.length; i += 3) {
        for (var a = 0; a < 3; a++) {
          if (p[i + a] < lo[a]) lo[a] = p[i + a];
          if (p[i + a] > hi[a]) hi[a] = p[i + a];
        }
      }
    });

    var mid = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];

    var r2 = 0;
    meshes.forEach(function (mesh) {
      var p = mesh.position;
      for (var i = 0; i < p.length; i += 3) {
        var dx = p[i] - mid[0], dz = p[i + 2] - mid[2];
        var d = dx * dx + dz * dz;
        if (d > r2) r2 = d;
      }
    });

    return {
      lo: lo, hi: hi, mid: mid,
      size: [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]],
      xzRadius: Math.sqrt(r2)
    };
  };

})(window.Gifty = window.Gifty || {});
