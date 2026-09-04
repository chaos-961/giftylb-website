/* Gifty engine. Geometry.
 *
 * Builds the real three dimensional shape of a product out of three primitives
 * and nothing else. The same rule as the flat renderer applies here: a product
 * is data. A mug, a cap, a bottle, a tote, a photo block and a framed print
 * are all described by a `model` block in their recipe, and this file has never
 * heard of any of them.
 *
 *   lathe   a 2D profile revolved around the Y axis, optionally through part of
 *           a turn, with closed ends and an optional sag toward those ends.
 *           Mug body, bottle, cap crown, cap visor, lids, rings.
 *   box     a rounded box, built by subdividing a cube and pushing every point
 *           onto the rounded surface. Photo block, tote, a picture frame.
 *   tube    a circle swept along a 2D path. Mug handle, tote straps, seams.
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
     inside, and that closed loop is why it can be culled at all.

     `arcDeg` sweeps only part of a turn, centred on `arcMidDeg`. A partial sweep
     of a closed profile is a solid slab, a cap visor say, and its two ends are
     closed with a flat face each (`arcCaps: false` turns that off for a part
     that is buried in another). `droop` bends the sweep down toward its ends:
     every point drops by droop times its distance from the innermost radius
     times one minus the cosine of its angle from the middle, so the inner edge
     stays put and the outer corners sag. That is the difference between a
     bill and a saucer. `droopMidDeg` moves the angle the sag is measured
     from, so a crown built from two sweeps can slope toward one back: that
     is what makes a cap tall at the front and low behind. Normals are
     derived from the real surface, so the sag lights correctly. */

  /* Triangulate a simple polygon of [x, y] points by ear clipping. A profile
     has a dozen points, so the quadratic loop is nothing. Returns index
     triples, wound the way the polygon is traced. */
  function pointInTri(p, a, b, c) {
    var s1 = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    var s2 = (c[0] - b[0]) * (p[1] - b[1]) - (c[1] - b[1]) * (p[0] - b[0]);
    var s3 = (a[0] - c[0]) * (p[1] - c[1]) - (a[1] - c[1]) * (p[0] - c[0]);
    return s1 > 1e-12 && s2 > 1e-12 && s3 > 1e-12;
  }

  function earClip(pts) {
    var n = pts.length, i, j;
    if (n < 3) return [];
    var idx = [];
    for (i = 0; i < n; i++) idx.push(i);
    var area = 0;
    for (i = 0; i < n; i++) {
      var p = pts[i], q = pts[(i + 1) % n];
      area += p[0] * q[1] - q[0] * p[1];
    }
    if (Math.abs(area) < 1e-9) return [];
    if (area < 0) idx.reverse();
    var tris = [];
    var guard = 0;
    while (idx.length > 3 && guard++ < 4000) {
      var found = false;
      for (i = 0; i < idx.length; i++) {
        var a = idx[(i + idx.length - 1) % idx.length];
        var b = idx[i];
        var c = idx[(i + 1) % idx.length];
        var A = pts[a], B = pts[b], C = pts[c];
        var cross = (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]);
        if (cross <= 1e-12) continue;
        var blocked = false;
        for (j = 0; j < idx.length; j++) {
          var d = idx[j];
          if (d === a || d === b || d === c) continue;
          if (pointInTri(pts[d], A, B, C)) { blocked = true; break; }
        }
        if (blocked) continue;
        tris.push(a, b, c);
        idx.splice(i, 1);
        found = true;
        break;
      }
      if (!found) break;
    }
    if (idx.length === 3) tris.push(idx[0], idx[1], idx[2]);
    return tris;
  }

  Mesh.lathe = function (spec) {
    var profile = spec.profile;
    var segments = spec.segments || 96;
    var arcDeg = spec.arcDeg == null ? 360 : spec.arcDeg;
    var arcMid = (spec.arcMidDeg || 0) * Math.PI / 180;
    var span = spec.printSpan;
    var droop = spec.droop || 0;
    /* Where the sag is measured from: the sweep's middle unless the part says
       otherwise, so two sweeps of one crown can sag toward the same back. */
    var droopMid = spec.droopMidDeg == null ? arcMid : spec.droopMidDeg * Math.PI / 180;
    var caps = arcDeg < 360 && spec.arcCaps !== false;

    var arc = arcDeg * Math.PI / 180;
    var cols = segments + 1;
    var rows = profile.length;
    var i, r, c;

    /* Arc length along the profile, used for v and for the normals. */
    var len = [0];
    var rIn = Infinity;
    for (i = 0; i < rows; i++) rIn = Math.min(rIn, profile[i][0]);
    for (i = 1; i < rows; i++) {
      var dr = profile[i][0] - profile[i - 1][0];
      var dy = profile[i][1] - profile[i - 1][1];
      len[i] = len[i - 1] + Math.sqrt(dr * dr + dy * dy);
    }

    var v0 = span ? len[span[0]] : 0;
    var v1 = span ? len[span[1]] : len[rows - 1];
    var vSpan = (v1 - v0) || 1;

    /* The cap polygon: the profile with duplicated points (creases, and the
       closing point) removed, remembering which row each corner came from. */
    var poly = [], polyRow = [];
    if (caps) {
      for (i = 0; i < rows; i++) {
        var prev = poly.length ? profile[polyRow[poly.length - 1]] : null;
        if (prev && Math.abs(prev[0] - profile[i][0]) < 1e-9 && Math.abs(prev[1] - profile[i][1]) < 1e-9) continue;
        poly.push(profile[i]); polyRow.push(i);
      }
      var first = profile[polyRow[0]], last = profile[polyRow[poly.length - 1]];
      if (poly.length > 1 && Math.abs(first[0] - last[0]) < 1e-9 && Math.abs(first[1] - last[1]) < 1e-9) {
        poly.pop(); polyRow.pop();
      }
      if (poly.length < 3) caps = false;
    }

    var m = build(rows * cols + (caps ? 2 * poly.length : 0));
    var k = 0;

    /* Where a profile row lands at an angle, sag included. */
    function place(row, theta) {
      var rad = profile[row][0];
      var sag = droop ? -droop * (rad - rIn) * (1 - Math.cos(theta - droopMid)) : 0;
      return [rad * Math.sin(theta), profile[row][1] + sag, rad * Math.cos(theta)];
    }

    for (r = 0; r < rows; r++) {
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

      for (c = 0; c < cols; c++) {
        var t = c / segments;
        var theta = arcMid + (t - 0.5) * arc;
        var s = Math.sin(theta), co = Math.cos(theta);
        var nx = nr * s, nyy = ny, nz = nr * co;
        var py = y;

        if (droop) {
          /* The sagging surface, differentiated by hand: along the sweep and
             along the profile, crossed the same way round as the flat case. */
          var wob = 1 - Math.cos(theta - droopMid);
          py = y - droop * (rad - rIn) * wob;
          var dhdt = -droop * (rad - rIn) * Math.sin(theta - droopMid);
          var dhdp = -droop * tr * wob;
          var ax = rad * co, ay = dhdt, az = -rad * s;
          var bx = tr * s, by = ty + dhdp, bz = tr * co;
          var gx = ay * bz - az * by, gy = az * bx - ax * bz, gz = ax * by - ay * bx;
          var gl = Math.sqrt(gx * gx + gy * gy + gz * gz);
          if (gl > 1e-9) { nx = gx / gl; nyy = gy / gl; nz = gz / gl; }
        }

        put(m, k++,
            rad * s, py, rad * co,
            nx, nyy, nz,
            0.5 + theta / TAU, v);
      }
    }

    m.n = k;
    grid(m, 0, rows, cols);

    if (caps) {
      var tris = earClip(poly.map(function (p, n) {
        var q = place(polyRow[n], arcMid - arc / 2);
        /* Triangulate in the profile plane, sag included, so a bent slab still
           reads as the simple polygon it is. */
        return [p[0], q[1]];
      }));
      var ends = [
        { theta: arcMid - arc / 2, sign: -1 },
        { theta: arcMid + arc / 2, sign: 1 }
      ];
      ends.forEach(function (end) {
        var th = end.theta;
        /* Straight out of the end face: the sweep direction, or its opposite. */
        var cnx = end.sign * Math.cos(th), cnz = -end.sign * Math.sin(th);
        var base = k;
        for (i = 0; i < poly.length; i++) {
          var pos = place(polyRow[i], th);
          put(m, k++, pos[0], pos[1], pos[2], cnx, 0, cnz, OFF, OFF);
        }
        for (i = 0; i < tris.length; i += 3) {
          var ia = base + tris[i], ib = base + tris[i + 1], ic = base + tris[i + 2];
          var P = m.position;
          var ux = P[ib * 3] - P[ia * 3], uy = P[ib * 3 + 1] - P[ia * 3 + 1], uz = P[ib * 3 + 2] - P[ia * 3 + 2];
          var vx = P[ic * 3] - P[ia * 3], vy = P[ic * 3 + 1] - P[ia * 3 + 1], vz = P[ic * 3 + 2] - P[ia * 3 + 2];
          var fx = uy * vz - uz * vy, fz = ux * vy - uy * vx;
          /* Wound to face out of the end, whichever way the polygon was traced. */
          if (fx * cnx + fz * cnz < 0) m.index.push(ia, ic, ib);
          else m.index.push(ia, ib, ic);
        }
      });
      m.n = k;
    }

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
      var halfU = p.uAxis === 'x' ? sx : (p.uAxis === 'y' ? sy : sz);
      var halfV = p.vAxis === 'x' ? sx : (p.vAxis === 'y' ? sy : sz);

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
              /* uv is measured in distance across the face, not in samples,
                 because the grid spends most of its samples on the rounded
                 edges and a print placed by sample count spilled over them.
                 v is measured back down the face, because the basis above runs
                 v up the object and the first row of an image is its top. */
              printable ? (uu + halfU) / (2 * halfU) : OFF,
              printable ? 1 - (vv + halfV) / (2 * halfV) : OFF);
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
    if (part.at || part.scale || part.rotY || part.rotX || part.rotZ) {
      var at = part.at || [0, 0, 0];
      var sc = part.scale || [1, 1, 1];
      if (typeof sc === 'number') sc = [sc, sc, sc];
      /* Scale first, then lean (X), then roll (Z), then turn (Y), then move.
         The order is fixed so a recipe can be read: a ribbon tail is authored
         hanging straight down, tilted outward, then swung round to its corner.
         Rotations are rigid, so the normals take exactly the same rotations
         and only the scale needs the inverse transpose. */
      var rx = (part.rotX || 0) * Math.PI / 180;
      var rz = (part.rotZ || 0) * Math.PI / 180;
      var ry = (part.rotY || 0) * Math.PI / 180;
      var cx = Math.cos(rx), sx = Math.sin(rx);
      var cz = Math.cos(rz), sz = Math.sin(rz);
      var cs = Math.cos(ry), sn = Math.sin(ry);
      var p = mesh.position, nm = mesh.normal;
      function turn(v) {
        var x = v[0], y = v[1], z = v[2], t;
        t = y * cx - z * sx; z = y * sx + z * cx; y = t;        /* about X */
        t = x * cz - y * sz; y = x * sz + y * cz; x = t;        /* about Z */
        t = x * cs + z * sn; z = -x * sn + z * cs; x = t;       /* about Y */
        v[0] = x; v[1] = y; v[2] = z;
        return v;
      }
      var v = [0, 0, 0];
      for (var i = 0; i < p.length; i += 3) {
        v[0] = p[i] * sc[0]; v[1] = p[i + 1] * sc[1]; v[2] = p[i + 2] * sc[2];
        turn(v);
        p[i] = v[0] + at[0];
        p[i + 1] = v[1] + at[1];
        p[i + 2] = v[2] + at[2];
        /* A normal transforms by the inverse transpose, which for a diagonal
           scale is one over the scale. Get this wrong and a squashed part
           lights as though it were not squashed. */
        v[0] = nm[i] / sc[0]; v[1] = nm[i + 1] / sc[1]; v[2] = nm[i + 2] / sc[2];
        var nl = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) || 1;
        v[0] /= nl; v[1] /= nl; v[2] /= nl;
        turn(v);
        nm[i] = v[0]; nm[i + 1] = v[1]; nm[i + 2] = v[2];
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
