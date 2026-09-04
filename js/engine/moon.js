/* Gifty engine. The Moon.
 *
 * Draws the real Moon for a real instant: the phase it had, the tilt of its
 * face, the terminator exactly where it fell. js/lunar.js works out where the
 * Sun and the Earth sit in the lunar sky; this file turns that into a disc.
 *
 * No library, same as the rest of the engine. There is no sphere mesh either.
 * The whole render is ONE QUAD: every pixel asks "where on the sphere am I",
 * lifts itself off the screen into a unit vector, turns that vector into the
 * Moon's own coordinates, and shades it. The same maths runs twice, once as a
 * fragment shader and once as a plain loop over an ImageData, and the second
 * is the fallback when WebGL is missing. It is also what tools/test-moon.mjs
 * runs in node, which is how a picture of the Moon gets checked without a
 * browser: the software path takes raw RGBA and gives back raw RGBA.
 *
 * ---------------------------------------------------------------------------
 * THE MATHS, IN ORDER
 *
 *   POSE.  Model space is selenographic: lon 0, lat 0 is +x, the north pole is
 *     +y, lon 90 east is -z. selenoVec() is that mapping. The sub-Earth point
 *     (the libration in lon and lat) must face the viewer, and lunar north must
 *     lie along the position angle of the axis, measured eastward from north,
 *     which on a sky with north up is a lean to the LEFT: (-sin P, cos P). So
 *     the frame is: a3 = earthDir, a2 = north with its a3 component removed,
 *     a1 = a2 x a3; and on screen b3 = toward the viewer, b2 = (-sin P, cos P),
 *     b1 = b2 x b3. A screen point w lifts to model space as
 *     m = a1 (b1.w) + a2 (b2.w) + a3 (b3.w). That matrix is `toModel`.
 *
 *   LIGHT.  The Sun is not an arbitrary vector: it is the sub-solar point, in
 *     model space, so no rotation ever touches it. Shading is the template's:
 *     a tangent space normal map (T east, B north, straight from the mapping),
 *     Lommel-Seeliger mixed 28 per cent with Lambert, which is why a full
 *     moon reads as a flat bright disc and not a shaded ball, a half degree
 *     solar penumbra on the terminator, an opposition surge a few degrees
 *     wide, earthshine on the night side tinted by a nearly full Earth, then
 *     ACES and an sRGB encode. The colour map is decoded to linear first;
 *     skipping that lights an encoded value and leaves a white ball.
 *
 *   HALO.  A faint bloom outside the limb, brighter toward the Sun, scaled by
 *     illumination to the 1.5. It is what our own atmosphere adds and it is
 *     drawn behind the disc, never over it. It fits inside the canvas: the
 *     template's 1.85 radius reach is compressed to the inscribed circle when
 *     the disc is drawn large, so a square canvas never clips it.
 *
 * UV CONVENTIONS
 *
 *   The maps are plate carree, 1024 x 512, north at the top, lon 0 at the
 *   centre column. u = 0.5 + lon / 360 and v = 0.5 - lat / 180, sampled with
 *   LINEAR filtering, no mips, REPEAT across u and CLAMP_TO_EDGE on v. The
 *   textures are uploaded with UNPACK_FLIP_Y_WEBGL off so v = 0 is the top
 *   row, and the software sampler reads the same rows the same way. The
 *   normal map's x is an eastward tilt and its y a northward one.
 *
 *   The limb is anti-aliased from the known disc radius in pixels, the same
 *   one pixel ramp in both paths, so the two renders match at the edge too.
 */
(function (G) {
  'use strict';

  var Moon = G.Moon = {};

  var DEG = Math.PI / 180;
  var EXPOSURE = 1.9;      /* tuned on a rendered full moon's histogram */
  var RELIEF = 1.0;
  var GLOW_REACH = 1.85;   /* the template's halo sphere, in disc radii */
  var GLOW_REACH2 = GLOW_REACH * GLOW_REACH;
  var TINT = [0.86, 0.90, 1.0];
  var MEAN_DISTANCE_KM = 385000;

  var DEFAULTS = { size: 1400, radius: 0.86, fixed: true, glow: 0.35, earthshine: true };

  /* Where the two maps live, relative to the page. A probe under tools/ sets
     a base href instead of changing this. */
  Moon.ASSETS = 'assets/moon/';

  function lunar() {
    if (!G.Lunar) throw new Error('js/lunar.js must load before js/engine/moon.js is used');
    return G.Lunar;
  }

  /* ----------------------------------------------------------- the state */

  Moon.stateAt = function (date) {
    return lunar().stateAt(date);
  };

  /* Plain numbers and words for a caption. */
  Moon.describe = function (state) {
    var L = lunar();
    return {
      phase: L.phaseName(state.ageAngle),
      illumination: Math.round(state.illumination * 100),
      ageDays: Math.round(state.ageAngle / 360 * L.SYNODIC * 10) / 10,
      distanceKm: Math.round(state.distanceKm),
      distanceLabel: L.distanceLabel(state.distanceKm),
      zodiac: L.zodiacSign(state.moonLon),
      waxing: !!state.waxing,
      lunation: L.lunationNumber(state.jd)
    };
  };

  /* ------------------------------------------------------------- the pose */

  /* Selenographic coordinates to a model space unit vector. Fixed by the NASA
     mosaic: lon 0 is the centre column with east to the right, which puts Mare
     Crisium in the upper right of the disc, where the sky has it. */
  function selenoVec(lonDeg, latDeg) {
    var lon = lonDeg * DEG, lat = latDeg * DEG;
    return [Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon)];
  }

  function cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }

  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

  function normalize(v) {
    var l = Math.sqrt(dot(v, v)) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  }

  /* Everything the shading needs that depends only on the instant: the Sun
     and the Earth in model space, the screen to model matrix (column major,
     ready for uniformMatrix3fv) and the Sun in screen space for the halo. */
  function frame(state) {
    var earth = selenoVec(state.librationLon, state.librationLat);
    var sun = selenoVec(state.subSolarLon, state.subSolarLat);

    var a3 = earth;
    var a2 = normalize([-a3[0] * a3[1], 1 - a3[1] * a3[1], -a3[2] * a3[1]]);
    var a1 = cross(a2, a3);

    var p = state.positionAngle * DEG;
    var b1 = [Math.cos(p), Math.sin(p), 0];
    var b2 = [-Math.sin(p), Math.cos(p), 0];
    var b3 = [0, 0, 1];

    var toModel = new Float32Array(9);
    for (var j = 0; j < 3; j++) {
      for (var i = 0; i < 3; i++) {
        toModel[j * 3 + i] = a1[i] * b1[j] + a2[i] * b2[j] + a3[i] * b3[j];
      }
    }

    var s1 = dot(a1, sun), s2 = dot(a2, sun), s3 = dot(a3, sun);
    var sunView = [
      b1[0] * s1 + b2[0] * s2 + b3[0] * s3,
      b1[1] * s1 + b2[1] * s2 + b3[1] * s3,
      b1[2] * s1 + b2[2] * s2 + b3[2] * s3
    ];

    return { sun: sun, earth: earth, toModel: toModel, sunView: sunView };
  }

  /* The numbers a draw needs, derived once per frame and shared by both
     paths. width, height and radiusPx are pixels; glow is the caller's 0 to 1
     already scaled by illumination; earthshine is the shader term. */
  function params(state, width, height, radiusPx, glow, earthshine) {
    var f = frame(state);
    var reach = Math.min(GLOW_REACH, Math.min(width, height) / 2 / radiusPx);
    return {
      width: width, height: height, radiusPx: radiusPx, reach: reach,
      glow: glow > 0 ? glow * Math.pow(state.illumination, 1.5) : 0,
      earthshine: earthshine ? 0.45 * Math.pow(1 - state.illumination, 1.6) : 0,
      phase: state.phaseAngle * DEG,
      sun: f.sun, earth: f.earth, sunView: f.sunView, toModel: f.toModel
    };
  }

  /* Render options to pixels. */
  function geometry(state, o) {
    var size = o.size || DEFAULTS.size;
    var radius = o.radius != null ? o.radius : DEFAULTS.radius;
    var r = radius * size / 2;
    if (o.fixed === false) r *= MEAN_DISTANCE_KM / state.distanceKm;
    return { width: size, height: size, radiusPx: r };
  }

  function options(o) {
    o = o || {};
    return {
      size: o.size || DEFAULTS.size,
      radius: o.radius != null ? o.radius : DEFAULTS.radius,
      fixed: o.fixed !== false,
      glow: o.glow != null ? o.glow : DEFAULTS.glow,
      earthshine: o.earthshine !== false,
      software: !!o.software,
      state: o.state || null,
      date: o.date || new Date()
    };
  }

  /* --------------------------------------------------------------- shaders */

  var VERT = [
    'attribute vec2 aPos;',
    'varying vec2 vPos;',
    'void main() {',
    '  vPos = aPos;',
    '  gl_Position = vec4(aPos, 0.0, 1.0);',
    '}'
  ].join('\n');

  var FRAG = [
    /* highp where the driver has it: the uv comes out of an asin and an atan
       of a screen position and mediump quantises that to a texel. */
    '#ifdef GL_FRAGMENT_PRECISION_HIGH',
    'precision highp float;',
    '#else',
    'precision mediump float;',
    '#endif',

    'varying vec2 vPos;',
    'uniform sampler2D uColor;',
    'uniform sampler2D uNormal;',
    'uniform mat3 uToModel;',    /* screen to selenographic */
    'uniform vec3 uSun;',        /* sub-solar point, model space */
    'uniform vec3 uEarth;',      /* sub-Earth point, model space */
    'uniform vec3 uSunView;',    /* the Sun in screen space, for the halo */
    'uniform vec2 uHalf;',       /* half the canvas, px */
    'uniform float uRadius;',    /* disc radius, px */
    'uniform float uReach;',     /* halo outer edge, disc radii */
    'uniform float uGlow;',
    'uniform float uPhase;',     /* phase angle, radians */
    'uniform float uEarthshine;',
    'uniform float uExposure;',
    'uniform float uRelief;',

    'vec3 aces(vec3 x) {',
    '  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);',
    '}',
    'vec3 toDisplay(vec3 linear) {',
    '  vec3 c = aces(linear);',
    '  return mix(c * 12.92, 1.055 * pow(max(c, 0.0031308), vec3(1.0 / 2.4)) - 0.055,',
    '             step(0.0031308, c));',
    '}',
    'vec3 toLinear(vec3 srgb) {',
    '  return mix(srgb / 12.92, pow((srgb + 0.055) / 1.055, vec3(2.4)),',
    '             step(0.04045, srgb));',
    '}',

    /* q is a point on the unit disc, x right and y up. */
    'vec3 shade(vec2 q) {',
    '  vec3 w = vec3(q, sqrt(max(1.0 - dot(q, q), 0.0)));',
    '  vec3 m = uToModel * w;',
    '  float lat = asin(clamp(m.y, -1.0, 1.0));',
    '  float lon = atan(-m.z, m.x);',
    '  vec2 uv = vec2(0.5 + lon / 6.283185307, 0.5 - lat / 3.14159265);',
    /* Tangent frame straight from the mapping: T runs east, B runs north.
       T is (sin phi, 0, cos phi) for phi = 2 pi u, written out from m so the
       pole never divides by zero. */
    '  float cl = max(length(m.xz), 1e-6);',
    '  vec3 T = vec3(m.z / cl, 0.0, -m.x / cl);',
    '  vec3 B = cross(m, T);',
    '  vec3 nm = texture2D(uNormal, uv).xyz * 2.0 - 1.0;',
    '  float nz = max(nm.z, 0.15);',
    '  vec3 N = normalize(m + uRelief * (nm.x / nz * T + nm.y / nz * B));',
    '  vec3 albedo = toLinear(texture2D(uColor, uv).rgb);',
    '  float mu0 = dot(N, uSun);',
    '  float mu = max(dot(N, uEarth), 0.0);',
    /* The Sun is half a degree wide seen from the Moon, so the terminator
       carries a real penumbra instead of a hard edge. */
    '  float lit = smoothstep(-0.0087, 0.0087, mu0);',
    '  float m0 = max(mu0, 0.0);',
    /* Lommel-Seeliger, single scattering off a dark porous regolith: the
       limb stays as bright as the centre, which is why a full moon looks
       like a flat disc rather than a shaded sphere. */
    '  float ls = m0 / max(m0 + mu, 0.02);',
    '  float brdf = mix(2.0 * ls, m0, 0.28);',
    /* Opposition surge from coherent backscatter, a few degrees wide. */
    '  float surge = 1.0 + 0.4 * exp(-uPhase / 0.105);',
    '  vec3 col = albedo * brdf * lit * surge * uExposure;',
    /* Earthshine. A nearly full Earth hangs over the lunar night side and
       lights it faintly blue, strongest when we see a thin crescent. */
    '  col += albedo * mu * uEarthshine * vec3(0.40, 0.54, 0.92) * (1.0 - lit);',
    '  return toDisplay(col);',
    '}',

    /* Alpha of the halo at p (disc radii), rho = length(p). The template's
       glow sphere, read from its back face, with its radius compressed so
       the bloom ends at uReach. */
    'float halo(vec2 p, float rho) {',
    '  if (uGlow <= 0.0 || uReach <= 1.001 || rho >= uReach) return 0.0;',
    '  float t = 1.0 + (rho - 1.0) * (0.85 / (uReach - 1.0));',
    '  float nz = sqrt(max(3.4225 - t * t, 0.0)) / 1.85;',
    '  float shape = pow(nz, 2.2);',
    '  vec3 n = vec3(p / max(rho, 1e-6) * (t / 1.85), -nz);',
    '  float side = smoothstep(-0.35, 0.6, dot(n, uSunView));',
    '  return shape * uGlow * (0.25 + 0.75 * side);',
    '}',

    'void main() {',
    '  vec2 p = vPos * uHalf / uRadius;',
    '  float rho = length(p);',
    '  float cov = smoothstep(-0.5, 0.5, (1.0 - rho) * uRadius);',
    '  float h = halo(p, rho);',
    '  vec3 disc = vec3(0.0);',
    '  if (cov > 0.0) disc = shade(p / max(rho, 1.0));',
    /* Disc over halo, straight alpha, then written premultiplied because
       that is what the canvas expects. */
    '  float a = cov + h * (1.0 - cov);',
    '  vec3 rgb = disc * cov + vec3(0.86, 0.90, 1.0) * h * (1.0 - cov);',
    '  gl_FragColor = vec4(rgb, a);',
    '}'
  ].join('\n');

  /* ------------------------------------------------------------ the maps */

  var texPromise = null;
  var rawCache = null;

  function assetPath(name) {
    var p = Moon.ASSETS + name;
    return G.Recipe && G.Recipe.bust ? G.Recipe.bust(p) : p;
  }

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('moon map failed to load: ' + src)); };
      img.src = src;
    });
  }

  /* Resolves to { color, normal }, two decoded images. One promise for the
     life of the page; a failed load clears it so the next call retries. */
  Moon.textures = function () {
    if (texPromise) return texPromise;
    texPromise = Promise.all([assetPath('color.jpg'), assetPath('normal.jpg')].map(loadImage))
      .then(function (imgs) { return { color: imgs[0], normal: imgs[1] }; });
    texPromise.then(null, function () { texPromise = null; });
    return texPromise;
  };

  /* The same two maps as raw RGBA, for the software path. */
  function rawTextures(tex) {
    if (rawCache) return rawCache;
    function pull(img) {
      var c = document.createElement('canvas');
      c.width = img.naturalWidth || img.width;
      c.height = img.naturalHeight || img.height;
      var ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      return ctx.getImageData(0, 0, c.width, c.height);
    }
    var a = pull(tex.color), b = pull(tex.normal);
    if (a.width !== b.width || a.height !== b.height) {
      throw new Error('the colour map and the normal map must be the same size');
    }
    rawCache = { color: a.data, normal: b.data, w: a.width, h: a.height };
    return rawCache;
  }

  /* ------------------------------------------------------- the GL renderer */

  Moon.supported = function () {
    try {
      var c = document.createElement('canvas');
      return !!(window.WebGLRenderingContext &&
                (c.getContext('webgl') || c.getContext('experimental-webgl')));
    } catch (e) { return false; }
  };

  var GL_ATTRS = {
    alpha: true, premultipliedAlpha: true, antialias: false, depth: false,
    stencil: false, preserveDrawingBuffer: true
  };

  /* One quad, one program, two textures. Returns null when the canvas will
     not give a context or the shader will not build. */
  function createGL(canvas) {
    var gl = canvas.getContext('webgl', GL_ATTRS) || canvas.getContext('experimental-webgl', GL_ATTRS);
    if (!gl) return null;

    function compile(type, src) {
      var s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        throw new Error('shader: ' + gl.getShaderInfoLog(s));
      }
      return s;
    }

    var prog;
    try {
      prog = gl.createProgram();
      gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        throw new Error('program: ' + gl.getProgramInfoLog(prog));
      }
    } catch (e) {
      if (window.console) console.warn('moon unavailable in WebGL:', e.message);
      return null;
    }

    var loc = {};
    ['uColor', 'uNormal', 'uToModel', 'uSun', 'uEarth', 'uSunView', 'uHalf', 'uRadius',
     'uReach', 'uGlow', 'uPhase', 'uEarthshine', 'uExposure', 'uRelief']
      .forEach(function (n) { loc[n] = gl.getUniformLocation(prog, n); });
    var aPos = gl.getAttribLocation(prog, 'aPos');

    var quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);

    var maxDim = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
    var textures = null;
    var lost = false;
    canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); lost = true; }, false);

    /* Plate carree maps: wrap in longitude, clamp at the poles, no mips. */
    function upload(img) {
      var t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      return t;
    }

    return {
      canvas: canvas,
      lost: function () { return lost || gl.isContextLost(); },
      fits: function (w, h) { return w <= maxDim[0] && h <= maxDim[1]; },
      setMaps: function (tex) {
        textures = { color: upload(tex.color), normal: upload(tex.normal) };
      },
      hasMaps: function () { return !!textures; },
      draw: function (P) {
        if (canvas.width !== P.width) canvas.width = P.width;
        if (canvas.height !== P.height) canvas.height = P.height;
        gl.viewport(0, 0, P.width, P.height);
        gl.disable(gl.BLEND);
        gl.disable(gl.DEPTH_TEST);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(prog);
        gl.bindBuffer(gl.ARRAY_BUFFER, quad);
        gl.enableVertexAttribArray(aPos);
        gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, textures.color);
        gl.uniform1i(loc.uColor, 0);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, textures.normal);
        gl.uniform1i(loc.uNormal, 1);
        gl.uniformMatrix3fv(loc.uToModel, false, P.toModel);
        gl.uniform3fv(loc.uSun, P.sun);
        gl.uniform3fv(loc.uEarth, P.earth);
        gl.uniform3fv(loc.uSunView, P.sunView);
        gl.uniform2f(loc.uHalf, P.width / 2, P.height / 2);
        gl.uniform1f(loc.uRadius, P.radiusPx);
        gl.uniform1f(loc.uReach, P.reach);
        gl.uniform1f(loc.uGlow, P.glow);
        gl.uniform1f(loc.uPhase, P.phase);
        gl.uniform1f(loc.uEarthshine, P.earthshine);
        gl.uniform1f(loc.uExposure, EXPOSURE);
        gl.uniform1f(loc.uRelief, RELIEF);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      },
      destroy: function () {
        var ext = gl.getExtension('WEBGL_lose_context');
        if (ext) ext.loseContext();
      }
    };
  }

  /* Every Moon.render shares one offscreen context, the way the shop cards
     share one per product: a context per picture runs the tab out of them. */
  var shared = null;
  var glTried = false;

  function sharedGL() {
    if (shared && !shared.lost()) return shared;
    if (glTried && !shared) return null;
    glTried = true;
    if (!Moon.supported()) return null;
    var c = document.createElement('canvas');
    c.style.maxInlineSize = 'none';
    shared = createGL(c);
    return shared;
  }

  /* ------------------------------------------------------- the software path */

  function toLinear(c) {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  function toDisplay(x) {
    x = (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14);
    if (x < 0) x = 0; else if (x > 1) x = 1;
    return x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
  }

  function smoothstep(e0, e1, x) {
    var t = (x - e0) / (e1 - e0);
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    return t * t * (3 - 2 * t);
  }

  /* The fragment shader as a loop. Takes the two maps as raw RGBA of the
     same size, returns straight alpha RGBA the size of the canvas. This is
     the function tools/test-moon.mjs runs in node. */
  function renderSoftware(colorData, normalData, w, h, state, o) {
    o = options(o);
    var g = geometry(state, o);
    var W = o.width || g.width, H = o.height || g.height;
    var R = o.radiusPx || g.radiusPx;
    var P = params(state, W, H, R, o.glow, o.earthshine);

    var out = new Uint8ClampedArray(W * H * 4);
    var M = P.toModel, sun = P.sun, earth = P.earth, sv = P.sunView;
    var surgeExp = EXPOSURE * (1 + 0.4 * Math.exp(-P.phase / 0.105));
    var es = P.earthshine;
    var reach = P.reach, glow = P.glow;
    var haloOn = glow > 0 && reach > 1.001;
    var haloK = haloOn ? 0.85 / (reach - 1) : 0;
    var skip = Math.max(reach, 1) + 1 / R;
    var hx = W / 2, hy = H / 2;
    var TWO_PI = Math.PI * 2;
    var lastRow = h - 1;

    for (var y = 0; y < H; y++) {
      var py = (hy - (y + 0.5)) / R;
      var row = y * W * 4;
      for (var x = 0; x < W; x++) {
        var px = ((x + 0.5) - hx) / R;
        var rho = Math.sqrt(px * px + py * py);
        if (rho >= skip) continue;

        var cov = smoothstep(-0.5, 0.5, (1 - rho) * R);

        var ha = 0;
        if (haloOn && rho < reach) {
          var t = 1 + (rho - 1) * haloK;
          var nz = Math.sqrt(Math.max(GLOW_REACH2 - t * t, 0)) / GLOW_REACH;
          var shape = Math.pow(nz, 2.2);
          var inv = t / GLOW_REACH / Math.max(rho, 1e-6);
          var side = smoothstep(-0.35, 0.6, px * inv * sv[0] + py * inv * sv[1] - nz * sv[2]);
          ha = shape * glow * (0.25 + 0.75 * side);
        }
        if (cov <= 0 && ha <= 0) continue;

        var dr = 0, dg = 0, db = 0;
        if (cov > 0) {
          /* Lift the pixel onto the sphere, then into model space. */
          var q = Math.max(rho, 1);
          var qx = px / q, qy = py / q;
          var qz = Math.sqrt(Math.max(1 - qx * qx - qy * qy, 0));
          var mx = M[0] * qx + M[3] * qy + M[6] * qz;
          var my = M[1] * qx + M[4] * qy + M[7] * qz;
          var mz = M[2] * qx + M[5] * qy + M[8] * qz;
          if (my > 1) my = 1; else if (my < -1) my = -1;
          var lat = Math.asin(my);
          var lon = Math.atan2(-mz, mx);
          var u = 0.5 + lon / TWO_PI;
          var v = 0.5 - lat / Math.PI;

          /* Bilinear, wrapping across u and clamping v, texel centres at
             half integers: what LINEAR with REPEAT and CLAMP_TO_EDGE does. */
          var sx = u * w - 0.5, sy = v * h - 0.5;
          var x0 = Math.floor(sx), y0 = Math.floor(sy);
          var fx = sx - x0, fy = sy - y0;
          x0 = ((x0 % w) + w) % w;
          var x1 = x0 + 1 === w ? 0 : x0 + 1;
          var y1 = y0 + 1;
          if (y0 < 0) y0 = 0; else if (y0 > lastRow) y0 = lastRow;
          if (y1 < 0) y1 = 0; else if (y1 > lastRow) y1 = lastRow;
          var i00 = (y0 * w + x0) * 4, i10 = (y0 * w + x1) * 4;
          var i01 = (y1 * w + x0) * 4, i11 = (y1 * w + x1) * 4;
          var w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;

          var nmx = (normalData[i00] * w00 + normalData[i10] * w10 + normalData[i01] * w01 + normalData[i11] * w11) / 127.5 - 1;
          var nmy = (normalData[i00 + 1] * w00 + normalData[i10 + 1] * w10 + normalData[i01 + 1] * w01 + normalData[i11 + 1] * w11) / 127.5 - 1;
          var nmz = (normalData[i00 + 2] * w00 + normalData[i10 + 2] * w10 + normalData[i01 + 2] * w01 + normalData[i11 + 2] * w11) / 127.5 - 1;
          if (nmz < 0.15) nmz = 0.15;

          var ar = toLinear(colorData[i00] * w00 + colorData[i10] * w10 + colorData[i01] * w01 + colorData[i11] * w11);
          var ag = toLinear(colorData[i00 + 1] * w00 + colorData[i10 + 1] * w10 + colorData[i01 + 1] * w01 + colorData[i11 + 1] * w11);
          var ab = toLinear(colorData[i00 + 2] * w00 + colorData[i10 + 2] * w10 + colorData[i01 + 2] * w01 + colorData[i11 + 2] * w11);

          /* Tangent frame: T east, B = m x T north. */
          var cl = Math.sqrt(mx * mx + mz * mz);
          if (cl < 1e-6) cl = 1e-6;
          var tx = mz / cl, tz = -mx / cl;
          var bx = my * tz, by = mz * tx - mx * tz, bz = -my * tx;
          var kx = nmx / nmz * RELIEF, ky = nmy / nmz * RELIEF;
          var nx = mx + kx * tx + ky * bx;
          var ny = my + ky * by;
          var nzz = mz + kx * tz + ky * bz;
          var nl = Math.sqrt(nx * nx + ny * ny + nzz * nzz) || 1;
          nx /= nl; ny /= nl; nzz /= nl;

          var mu0 = nx * sun[0] + ny * sun[1] + nzz * sun[2];
          var mu = nx * earth[0] + ny * earth[1] + nzz * earth[2];
          if (mu < 0) mu = 0;
          var lit = smoothstep(-0.0087, 0.0087, mu0);
          var m0 = mu0 > 0 ? mu0 : 0;
          var ls = m0 / Math.max(m0 + mu, 0.02);
          var brdf = 2 * ls * 0.72 + m0 * 0.28;
          var day = brdf * lit * surgeExp;
          var night = mu * es * (1 - lit);
          dr = toDisplay(ar * (day + night * 0.40));
          dg = toDisplay(ag * (day + night * 0.54));
          db = toDisplay(ab * (day + night * 0.92));
        }

        /* Disc over halo, kept as straight alpha for the ImageData. */
        var a = cov + ha * (1 - cov);
        var hw = ha * (1 - cov);
        var i = row + x * 4;
        out[i] = (dr * cov + TINT[0] * hw) / a * 255;
        out[i + 1] = (dg * cov + TINT[1] * hw) / a * 255;
        out[i + 2] = (db * cov + TINT[2] * hw) / a * 255;
        out[i + 3] = a * 255;
      }
    }
    return { data: out, width: W, height: H, radiusPx: R };
  }

  /* -------------------------------------------------------------- render */

  /* A transparent canvas with the lit disc centred on it. WebGL when the
     browser has it, the loop above when it does not, and opts.software
     forces the loop so the two can be compared. */
  Moon.render = function (opts) {
    var o = options(opts);
    var state = o.state || Moon.stateAt(o.date);
    return Moon.textures().then(function (tex) {
      var g = geometry(state, o);
      var out = document.createElement('canvas');
      out.width = g.width;
      out.height = g.height;
      out.style.maxInlineSize = 'none';
      var ctx = out.getContext('2d');

      if (!o.software) {
        var s = sharedGL();
        if (s && s.fits(g.width, g.height)) {
          if (!s.hasMaps()) s.setMaps(tex);
          s.draw(params(state, g.width, g.height, g.radiusPx, o.glow, o.earthshine));
          if (!s.lost()) {
            ctx.drawImage(s.canvas, 0, 0);
            return out;
          }
        }
      }

      var raw = rawTextures(tex);
      var px = renderSoftware(raw.color, raw.normal, raw.w, raw.h, state, o);
      ctx.putImageData(new ImageData(px.data, px.width, px.height), 0, 0);
      return out;
    });
  };

  /* ---------------------------------------------------------------- live */

  /* A canvas that follows a clock. WebGL draws straight into it; without
     WebGL, set() renders the software disc at 320px and blits it, at most
     once every 120 ms, dropping calls in between. */
  Moon.live = function (canvas) {
    var state = null;
    var radiusPx = null;
    var api = {
      supported: false,
      scaleByDistance: false,
      set: null, draw: null, resize: null, setRadius: null, destroy: null
    };

    function discRadius() {
      var r = radiusPx || 0.44 * Math.min(canvas.width, canvas.height);
      if (api.scaleByDistance && state) r *= MEAN_DISTANCE_KM / state.distanceKm;
      return r;
    }

    api.setRadius = function (px) { radiusPx = px || null; if (state) api.draw(); };
    api.resize = function (w, h) {
      canvas.width = w;
      canvas.height = h;
      if (state) api.draw();
    };

    var ctx = Moon.supported() ? createGL(canvas) : null;

    if (ctx) {
      api.supported = true;
      var mapsReady = false;
      Moon.textures().then(function (tex) {
        if (ctx.lost()) return;
        ctx.setMaps(tex);
        mapsReady = true;
        if (state) api.draw();
      });
      api.set = function (date) {
        state = date && date.jd != null ? date : Moon.stateAt(date || new Date());
        api.draw();
      };
      api.draw = function () {
        if (!state || !mapsReady || ctx.lost()) return;
        var W = canvas.width, H = canvas.height;
        ctx.draw(params(state, W, H, discRadius(), DEFAULTS.glow, true));
      };
      api.destroy = function () { state = null; ctx.destroy(); };
      return api;
    }

    /* No WebGL. */
    var SOFT = 320;
    var last = 0, timer = null, latest = null, busy = false;
    var ctx2d = canvas.getContext('2d');

    function blit(c) {
      if (!ctx2d) return;
      latest = c;
      var r = discRadius();
      var k = r / (DEFAULTS.radius * SOFT / 2);
      var side = SOFT * k;
      ctx2d.clearRect(0, 0, canvas.width, canvas.height);
      ctx2d.drawImage(c, canvas.width / 2 - side / 2, canvas.height / 2 - side / 2, side, side);
    }

    function fire() {
      timer = null;
      if (!state || busy) return;
      busy = true;
      last = Date.now();
      Moon.render({ state: state, size: SOFT, software: true }).then(function (c) {
        busy = false;
        blit(c);
      }, function () { busy = false; });
    }

    api.set = function (date) {
      state = date && date.jd != null ? date : Moon.stateAt(date || new Date());
      if (timer) return;
      var wait = 120 - (Date.now() - last);
      if (wait > 0 || busy) timer = setTimeout(fire, Math.max(wait, 16));
      else fire();
    };
    api.draw = function () { if (latest) blit(latest); };
    api.destroy = function () {
      if (timer) clearTimeout(timer);
      timer = null;
      state = null;
      latest = null;
    };
    return api;
  };

  /* --------------------------------------------------------------- glyph */

  /* The small flat phase mark: the disc cut by the terminator ellipse.
     Waxing lights the right hand side, which is what a northern hemisphere
     observer sees with north up. */
  Moon.glyph = function (ctx, state, cx, cy, r, opts) {
    opts = opts || {};
    var lit = opts.lit || '#F4F1E8';
    var dark = opts.dark || 'rgba(20,32,31,0.9)';
    var k = Math.max(0, Math.min(1, state.illumination));
    var waxing = !!state.waxing;

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = dark;
    ctx.fill();

    if (k > 0.004) {
      /* Terminator half width, negative when the lit part is concave. */
      var t = r * (1 - 2 * k);
      ctx.beginPath();
      ctx.arc(cx, cy, r, -Math.PI / 2, Math.PI / 2, !waxing);
      ctx.ellipse(cx, cy, Math.abs(t), r, 0, Math.PI / 2, -Math.PI / 2, (t > 0) === waxing);
      ctx.closePath();
      ctx.fillStyle = lit;
      ctx.fill();
    }
    ctx.restore();
  };

  /* Pure maths, for tools/test-moon.mjs and the probe. */
  Moon._software = {
    renderSoftware: renderSoftware,
    frame: frame,
    params: params,
    selenoVec: selenoVec,
    EXPOSURE: EXPOSURE,
    RELIEF: RELIEF,
    DEFAULTS: DEFAULTS
  };

})(window.Gifty = window.Gifty || {});
