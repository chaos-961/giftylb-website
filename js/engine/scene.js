/* Gifty engine. The three dimensional preview.
 *
 * Draws the real object. Same rule as everywhere else in the engine: this file
 * has never heard of a mug. It takes a `model` block out of a recipe, asks
 * js/engine/mesh.js for the geometry, paints the buyer's artwork onto the parts
 * the recipe says are printable, and lights it.
 *
 * There is no library under this. WebGL is the whole dependency, the shaders
 * are two hundred lines, and the project's standing rule is no build step and
 * no vendored runtime, so a three megabyte scene graph was never on the table.
 *
 * How the artwork gets onto a curved surface, in one paragraph: every mesh
 * emits uv that runs 0 to 1 across the printable part of its surface and out of
 * range everywhere else. For each part that prints, this file composites that
 * part's zones into a single canvas laid out in the part's own uv space, and
 * uploads it as one texture. So the fragment shader does not sample a rectangle
 * inside a rectangle, it samples vUv, and the geometry has already done the
 * work of deciding where on a handle or a lid that is. Which is nowhere.
 *
 * Nothing here draws the print file or the proof. Those stay with the flat
 * renderer, because what gets printed is flat and a photograph of a mug is not
 * a thing a press can output.
 *
 * ---------------------------------------------------------------------------
 * WHAT MAKES IT LOOK LIKE A PHOTOGRAPH AND NOT A DIAGRAM
 *
 * The first version of this file lit with three directional lights and a Phong
 * exponent, and every product came out of it looking like grey plastic. Three
 * things fixed that, and none of them is a bigger light rig:
 *
 *   A ROOM.  Real objects are lit by everything around them, not by three
 *     arrows. `env()` is a procedural photographer's studio: a soft ceiling, a
 *     warm floor, one big key softbox up and to the left, a smaller cool fill
 *     on the right, and a dark band at the back wall. Diffuse reads it along
 *     the normal, specular reads it along the reflection vector, and roughness
 *     widens the sources the way a real blurred reflection does. The dark band
 *     is the single most load bearing thing in it: a glossy edge with nothing
 *     dark to reflect has no edge, which is why the first mug had no silhouette
 *     against a white page.
 *
 *   A FLOOR.  The object is drawn a second time, mirrored through the plane it
 *     stands on, faded with height and blended under the contact shadow. It
 *     costs one extra pass over the same buffers and it is the difference
 *     between an object standing on a surface and a cut out floating above one.
 *
 *   CONTACT.  Ambient occlusion darkening the last third of the object's height
 *     into the floor, and a contact shadow with two lobes rather than one: a
 *     tight dark core where the object actually touches, and a wide soft skirt
 *     for everything the room bounces around it. One lobe always reads as an
 *     airbrushed smudge.
 */
(function (G) {
  'use strict';

  var Scene = G.Scene = {};

  /* ---------------------------------------------------------------- shaders */

  var VERT = [
    'attribute vec3 aPos;',
    'attribute vec3 aNormal;',
    'attribute vec2 aUv;',
    'uniform mat4 uProj;',
    'uniform mat4 uView;',
    'varying vec3 vNormal;',
    'varying vec3 vPos;',
    'varying vec2 vUv;',
    'void main() {',
    /* vPos and vNormal are the TRUE surface, never the mirrored one. The
       reflection pass changes only where the vertex lands on screen, because a
       mirror shows the same object lit by the same room from a different side.
       Mirroring the normals as well lights the reflection from underneath and
       it stops looking like a reflection within one frame. */
    '  vNormal = aNormal;',
    '  vPos = aPos;',
    '  vUv = aUv;',
    '  gl_Position = uProj * uView * vec4(aPos, 1.0);',
    '}'
  ].join('\n');

  var FRAG = [
    /* highp where the driver has it. The specular lobe is a pow with an
       exponent in the hundreds, and in mediump that quantises into visible
       rings across a curved highlight. */
    '#ifdef GL_FRAGMENT_PRECISION_HIGH',
    'precision highp float;',
    '#else',
    'precision mediump float;',
    '#endif',

    'varying vec3 vNormal;',
    'varying vec3 vPos;',
    'varying vec2 vUv;',

    'uniform vec3 uColor;',
    'uniform sampler2D uArt;',
    'uniform float uHasArt;',
    'uniform float uGloss;',   /* how much of the room the surface returns */
    'uniform float uRough;     ', /* 0 mirror, 1 chalk */
    'uniform float uMetal;',
    'uniform float uCoat;',    /* a clear glaze over a matte body: mug, block */
    'uniform vec3 uEye;',
    'uniform float uFloorY;',
    'uniform float uSpan;',
    'uniform float uAlpha;',   /* 1 for the object, a fade for its reflection */

    'const float PI = 3.14159265;',

    /* The two sources in the room. Directions, not positions: the studio is
       infinitely far away, which is what a softbox four times the size of the
       subject effectively is. */
    /* The key is up, to the left and well IN FRONT of the subject, not off to
       the side. Side lighting is dramatic and it is also what left the front of
       a white mug two hundred sRGB values darker than its own edge, which reads
       as a dirty mug rather than a lit one. */
    'const vec3 KEY  = vec3(-0.3499, 0.7197, 0.5998);',
    'const vec3 FILL = vec3( 0.8607, 0.2002, 0.4680);',

    'vec3 toLinear(vec3 c) { return pow(c, vec3(2.2)); }',
    'vec3 toSrgb(vec3 c) { return pow(c, vec3(1.0 / 2.2)); }',

    /* ------------------------------------------------------------- the room

       Returns the radiance arriving from direction d, blurred by rough. It is
       four terms and they are in order of how much they matter:

         base   the room itself: warm ceiling, neutral walls, warm floor
         key    the big softbox, values well above one because it is a light
         fill   a smaller cooler panel opposite it, so the shadow side is not
                a dead grey
         band   the dark back wall just under the horizon. Everything glossy
                reflects it as a dark line along its own edge, and that line IS
                the silhouette on a white page. */
    'vec3 env(vec3 d, float rough) {',
    '  float up = d.y;',
    '  vec3 ceil  = vec3(1.06, 1.04, 1.00);',
    '  vec3 wall  = vec3(0.70, 0.73, 0.75);',
    '  vec3 floorC= vec3(0.34, 0.33, 0.31);',
    '  vec3 base = mix(floorC, wall, smoothstep(-0.60, 0.02, up));',
    '  base = mix(base, ceil, smoothstep(0.00, 0.85, up));',
    /* The room is brighter on the key side and darker opposite it. Without
       this the walls are one value all the way round, and a flat panel, which
       reflects a single direction across its whole face, comes back as one flat
       grey rectangle. A gradient across a sheet of acrylic is the only thing
       that says it is acrylic. */
    '  base *= mix(0.72, 1.22, clamp(d.x * -0.5 + 0.5, 0.0, 1.0));',

    /* A sharp lobe when the surface is a mirror and a very wide one when it is
       chalk. Capped at 160 because past that the highlight is smaller than a
       pixel and turns into sparkle. */
    '  float sharp = mix(160.0, 2.0, clamp(rough, 0.0, 1.0));',
    '  float key  = pow(max(dot(d, KEY), 0.0), sharp);',
    '  float fill = pow(max(dot(d, FILL), 0.0), mix(70.0, 1.5, clamp(rough, 0.0, 1.0)));',

    /* Widening the lobe spreads the same energy over more of the sphere, so it
       has to be dimmed or a rough surface ends up brighter than a mirror. */
    '  float norm = mix(1.0, 0.10, clamp(rough, 0.0, 1.0));',

    '  float band = smoothstep(0.26, -0.16, up) * smoothstep(-0.55, 0.25, d.z);',

    '  vec3 c = base',
    '        + key  * vec3(3.40, 3.31, 3.12) * norm',
    '        + fill * vec3(1.05, 1.20, 1.48) * norm;',
    /* The dark back wall belongs to the SHARP reflection and to nothing else.
       Applied to the diffuse term as well, which is this same function called
       with rough at one, it drops the whole shadow side of every object into
       the eighties and every product reads as grubby. */
    '  return c * mix(1.0, mix(1.0, 0.24, band), 1.0 - clamp(rough, 0.0, 1.0));',
    '}',

    /* GGX. Three functions, none of them optional: D is the shape of the
       highlight, G is how much of it the surface shadows from itself, F is how
       much more reflective everything gets at a glancing angle. Phong has none
       of the three and that is exactly why it reads as plastic. */
    'float distGGX(float NdH, float a) {',
    '  float a2 = a * a;',
    '  float d = NdH * NdH * (a2 - 1.0) + 1.0;',
    '  return a2 / max(PI * d * d, 1e-6);',
    '}',

    'float geoSmith(float NdV, float NdL, float a) {',
    '  float k = (a + 1.0) * (a + 1.0) / 8.0;',
    '  float gv = NdV / (NdV * (1.0 - k) + k);',
    '  float gl = NdL / (NdL * (1.0 - k) + k);',
    '  return gv * gl;',
    '}',

    'vec3 fresnel(float c, vec3 f0) {',
    '  return f0 + (1.0 - f0) * pow(1.0 - c, 5.0);',
    '}',

    /* ACES, the filmic curve. It rolls the highlights off into colour rather
       than into flat white, which is the difference between a lit teal mug and
       a teal mug with a white sticker on the shoulder. */
    'vec3 aces(vec3 x) {',
    '  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);',
    '}',

    'float hash(vec2 p) {',
    '  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);',
    '}',

    'void main() {',
    '  vec3 N = normalize(vNormal);',
    /* A mug is open at the top, so the inside of the wall faces away from us.
       Flipping on the back face is what stops the interior reading as a hole. */
    '  if (!gl_FrontFacing) N = -N;',
    '  vec3 V = normalize(uEye - vPos);',
    '  float NdV = max(dot(N, V), 1e-4);',

    '  vec3 albedo = uColor;',
    '  if (uHasArt > 0.5 && vUv.x >= 0.0 && vUv.x <= 1.0 && vUv.y >= 0.0 && vUv.y <= 1.0) {',
    '    vec4 art = texture2D(uArt, vUv);',
    '    albedo = mix(albedo, art.rgb, art.a);',
    '  }',
    '  albedo = toLinear(albedo);',

    /* ------------------------------------------------------------- contact

       Two terms. The height one darkens the bottom third into the floor, which
       is where a real object loses the room. The normal one darkens whatever
       faces down, which is where it loses it fastest. */
    '  float h = clamp((vPos.y - uFloorY) / max(uSpan * 0.40, 1e-4), 0.0, 1.0);',
    '  float ao = mix(0.58, 1.0, h * h * (3.0 - 2.0 * h));',
    '  ao *= mix(0.80, 1.0, smoothstep(-0.9, 0.45, N.y));',

    /* -------------------------------------------------------------- diffuse

       The room along the normal, plus the key as a direct light so the
       terminator is a real edge rather than a gradient. A metal has no diffuse
       at all, which is the one line that makes a metal lid read as metal. */
    '  float NdL = max(dot(N, KEY), 0.0);',
    /* The two numbers that set the exposure of the whole engine, and they are
       the two that had to be measured rather than reasoned about. Too high and
       a white mug is one flat page-white shape with no form at all, which is
       exactly what the first version of this shader produced. A lit surface
       lands near 0.74 in linear, a shadowed one near 0.20, and that gap is what
       a person reads as a curve. */
    '  vec3 irradiance = env(N, 1.0) * 0.42 + NdL * vec3(0.86, 0.84, 0.80);',
    '  vec3 diffuse = albedo * irradiance * (1.0 - uMetal) * ao;',

    /* ------------------------------------------------------------- specular

       A dielectric returns four percent of what hits it head on, whatever
       colour it is. A metal returns its own colour and nothing else. That one
       constant is most of what separates the two. */
    '  float rough = clamp(uRough, 0.045, 1.0);',
    '  float a = rough * rough;',
    '  vec3 f0 = mix(vec3(0.045), albedo, uMetal);',

    '  vec3 H = normalize(KEY + V);',
    '  float NdH = max(dot(N, H), 0.0);',
    '  float VdH = max(dot(V, H), 0.0);',
    '  vec3 F = fresnel(VdH, f0);',
    '  float D = distGGX(NdH, a);',
    '  float Gv = geoSmith(NdV, max(NdL, 1e-4), a);',
    '  vec3 direct = F * D * Gv / (4.0 * NdV * max(NdL, 1e-4)) * NdL * vec3(1.70, 1.67, 1.58);',

    /* The room seen in the surface. This is the term that carries a product
       shot: the shape of the softbox travelling across a curve is what a person
       reads as "glazed", and no amount of point highlight replaces it. */
    '  vec3 R = reflect(-V, N);',
    '  vec3 Fr = fresnel(NdV, f0);',
    '  vec3 reflected = env(R, rough) * Fr * uGloss * ao;',

    /* A clear coat over a matte body. A mug is a rough ceramic under a hard
       glaze, and one roughness cannot be both. This is a second, always sharp
       reflection layered on top at whatever strength the recipe asks for. */
    '  vec3 coat = env(R, 0.06) * fresnel(NdV, vec3(0.04)) * uCoat;',

    '  vec3 col = diffuse + direct * uGloss + reflected + coat;',

    /* The dither goes AFTER the gamma, not before it, and that is not a detail.
       A half step of noise in LINEAR space is a half step of the darkest
       eight bit value once the gamma has stretched the shadows, which is why
       the first version put visible grain all over a black mug and none at all
       on a white one. In output space it is half a code value everywhere. */
    '  vec3 outc = toSrgb(aces(col));',
    '  outc += (hash(gl_FragCoord.xy) - 0.5) / 255.0;',

    /* Premultiplied, because the canvas is and the reflection pass blends. */
    '  gl_FragColor = vec4(outc * uAlpha, uAlpha);',
    '}'
  ].join('\n');

  /* The contact shadow. A quad on the floor, and the falloff is two lobes
     rather than one: a tight dark core where the object actually meets the
     surface, and a wide soft skirt for the light the room bounces around it.
     One lobe at any radius reads as an airbrushed smudge, every time. */
  var SHADOW_VERT = [
    'attribute vec2 aXZ;',
    'uniform mat4 uProj;',
    'uniform mat4 uView;',
    'uniform vec3 uCentre;',
    'uniform vec2 uRadius;',
    'varying vec2 vXZ;',
    'void main() {',
    '  vXZ = aXZ;',
    '  vec3 p = vec3(uCentre.x + aXZ.x * uRadius.x, uCentre.y, uCentre.z + aXZ.y * uRadius.y);',
    '  gl_Position = uProj * uView * vec4(p, 1.0);',
    '}'
  ].join('\n');

  var SHADOW_FRAG = [
    'precision mediump float;',
    'varying vec2 vXZ;',
    'uniform float uAlpha;',
    'void main() {',
    /* The key is up and to the left and slightly in front, so the shadow is
       thrown back and to the right. Offsetting the sample rather than the quad
       keeps the quad's own bounds honest. */
    '  vec2 p = vXZ - vec2(0.16, -0.10);',
    '  float d = length(p);',
    '  float core = smoothstep(0.52, 0.0, d);',
    '  float skirt = smoothstep(1.0, 0.06, length(vXZ));',
    '  float a = (core * 0.62 + skirt * 0.44) * uAlpha;',
    '  a = clamp(a, 0.0, 1.0);',
    /* Premultiplied, to match the blend mode the canvas is composited with. */
    '  gl_FragColor = vec4(vec3(0.050, 0.092, 0.088) * a, a);',
    '}'
  ].join('\n');

  /* ---------------------------------------------------------------- matrices */

  function perspective(fovyDeg, aspect, near, far) {
    var f = 1 / Math.tan(fovyDeg * Math.PI / 360);
    var nf = 1 / (near - far);
    return new Float32Array([
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (far + near) * nf, -1,
      0, 0, 2 * far * near * nf, 0
    ]);
  }

  function lookAt(eye, target, up) {
    var zx = eye[0] - target[0], zy = eye[1] - target[1], zz = eye[2] - target[2];
    var zl = Math.sqrt(zx * zx + zy * zy + zz * zz) || 1;
    zx /= zl; zy /= zl; zz /= zl;
    var xx = up[1] * zz - up[2] * zy;
    var xy = up[2] * zx - up[0] * zz;
    var xz = up[0] * zy - up[1] * zx;
    var xl = Math.sqrt(xx * xx + xy * xy + xz * xz) || 1;
    xx /= xl; xy /= xl; xz /= xl;
    var yx = zy * xz - zz * xy;
    var yy = zz * xx - zx * xz;
    var yz = zx * xy - zy * xx;
    return new Float32Array([
      xx, yx, zx, 0,
      xy, yy, zy, 0,
      xz, yz, zz, 0,
      -(xx * eye[0] + xy * eye[1] + xz * eye[2]),
      -(yx * eye[0] + yy * eye[1] + yz * eye[2]),
      -(zx * eye[0] + zy * eye[1] + zz * eye[2]),
      1
    ]);
  }

  /* view * mirror, where mirror reflects through the horizontal plane y = f.
     Written out rather than fetched from a matrix library, because the mirror
     has four non-zero terms and a general multiply for it is sixty four. */
  function mirrored(view, f) {
    var out = new Float32Array(16);
    for (var c = 0; c < 4; c++) {
      var o = c * 4;
      /* column 0 and 2 are unchanged, column 1 negates, column 3 picks up the
         plane offset. The multiply is view * M with M diagonal but for that
         one translate term. */
      out[o] = view[o];
      out[o + 1] = view[o + 1];
      out[o + 2] = view[o + 2];
      out[o + 3] = view[o + 3];
    }
    /* M = [1,0,0,0, 0,-1,0,0, 0,0,1,0, 0,2f,0,1] in column major order. */
    out[4] = -view[4]; out[5] = -view[5]; out[6] = -view[6]; out[7] = -view[7];
    out[12] = view[12] + view[4] * 2 * f;
    out[13] = view[13] + view[5] * 2 * f;
    out[14] = view[14] + view[6] * 2 * f;
    out[15] = view[15] + view[7] * 2 * f;
    return out;
  }

  /* ------------------------------------------------------------------- utils */

  function hexToRgb(hex) {
    var h = String(hex || '#ffffff').replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    if (isNaN(n)) return [1, 1, 1];
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }

  /* Recipes written before roughness existed name a Phong exponent. This is the
     usual conversion between the two, so every existing product keeps the look
     it was tuned for and a new one can just say `rough` instead. */
  function roughOf(spec) {
    if (spec.rough != null) return spec.rough;
    var shine = spec.shine == null ? 40 : spec.shine;
    return Math.max(0.05, Math.min(1, Math.sqrt(2 / (shine + 2))));
  }

  Scene.supported = function () {
    try {
      var c = document.createElement('canvas');
      return !!(window.WebGLRenderingContext &&
                (c.getContext('webgl') || c.getContext('experimental-webgl')));
    } catch (e) { return false; }
  };

  /* --------------------------------------------------------------- the scene */

  Scene.create = function (canvas, recipe) {
    var model = recipe.model;
    if (!model || !model.parts || !model.parts.length) return null;

    var gl = canvas.getContext('webgl', {
      alpha: true, antialias: true, depth: true, premultipliedAlpha: true,
      preserveDrawingBuffer: true
    }) || canvas.getContext('experimental-webgl', {
      alpha: true, antialias: true, depth: true, premultipliedAlpha: true,
      preserveDrawingBuffer: true
    });
    if (!gl) return null;

    /* preserveDrawingBuffer, because the cart thumbnail is read back off this
       canvas after the frame has already been composited. Without it toDataURL
       returns a transparent rectangle on most drivers. */

    function compile(type, src) {
      var s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        throw new Error('shader: ' + gl.getShaderInfoLog(s));
      }
      return s;
    }

    function link(vs, fs) {
      var p = gl.createProgram();
      gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
      gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        throw new Error('program: ' + gl.getProgramInfoLog(p));
      }
      return p;
    }

    var prog, shadowProg;
    try {
      prog = link(VERT, FRAG);
      shadowProg = link(SHADOW_VERT, SHADOW_FRAG);
    } catch (e) {
      if (window.console) console.warn('3D preview unavailable:', e.message);
      return null;
    }

    var loc = {};
    ['uProj', 'uView', 'uColor', 'uArt', 'uHasArt', 'uGloss', 'uRough', 'uMetal',
     'uCoat', 'uEye', 'uFloorY', 'uSpan', 'uAlpha']
      .forEach(function (n) { loc[n] = gl.getUniformLocation(prog, n); });
    var aPos = gl.getAttribLocation(prog, 'aPos');
    var aNormal = gl.getAttribLocation(prog, 'aNormal');
    var aUv = gl.getAttribLocation(prog, 'aUv');

    var sloc = {};
    ['uProj', 'uView', 'uCentre', 'uRadius', 'uAlpha']
      .forEach(function (n) { sloc[n] = gl.getUniformLocation(shadowProg, n); });
    var aXZ = gl.getAttribLocation(shadowProg, 'aXZ');

    /* ------------------------------------------------------------- geometry */

    function buffer(data, target) {
      var b = gl.createBuffer();
      gl.bindBuffer(target, b);
      gl.bufferData(target, data, gl.STATIC_DRAW);
      return b;
    }

    var uintOk = !!gl.getExtension('OES_element_index_uint');
    var parts = model.parts.map(function (spec) {
      var mesh = G.Mesh.fromPart(spec);
      if (mesh.index instanceof Uint32Array && !uintOk) {
        throw new Error('model part needs 32 bit indices and the driver has none');
      }
      /* Where this part sits in the model, used by the reflection fade. A
         handle high on a mug returns almost nothing off the floor; a base sat
         on it returns nearly all of itself. */
      var loY = Infinity, hiY = -Infinity;
      for (var i = 1; i < mesh.position.length; i += 3) {
        if (mesh.position[i] < loY) loY = mesh.position[i];
        if (mesh.position[i] > hiY) hiY = mesh.position[i];
      }

      return {
        spec: spec,
        midY: (loY + hiY) / 2,
        pos: buffer(mesh.position, gl.ARRAY_BUFFER),
        nrm: buffer(mesh.normal, gl.ARRAY_BUFFER),
        uv: buffer(mesh.uv, gl.ARRAY_BUFFER),
        idx: buffer(mesh.index, gl.ELEMENT_ARRAY_BUFFER),
        type: mesh.index instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT,
        count: mesh.count,
        mesh: mesh,
        texture: null,
        atlas: null
      };
    });

    var bounds = G.Mesh.bounds(parts.map(function (p) { return p.mesh; }));

    var shadowQuad = buffer(new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.ARRAY_BUFFER);

    /* -------------------------------------------------------------- textures

       One texture per printing part, laid out in that part's uv space. Its size
       is chosen so the artwork lands at its own resolution rather than being
       resampled into a square: a mug wrap occupies a bit over half of the way
       around, so the atlas is that much wider than the artwork inside it. */

    var MAX_PIXELS = 3.6e6;

    function atlasFor(part) {
      var prints = part.spec.prints || (part.spec.print ? [part.spec.print] : []);
      if (!prints.length) return null;

      var w = 8, h = 8;
      prints.forEach(function (pr) {
        var zone = recipe.printZones.filter(function (z) { return z.id === pr.zoneId; })[0];
        if (!zone) return;
        var size = G.Design.sizeFor(zone);
        w = Math.max(w, Math.ceil(size.w / Math.max(0.02, pr.rect[2])));
        h = Math.max(h, Math.ceil(size.h / Math.max(0.02, pr.rect[3])));
      });

      var scale = Math.min(1, Math.sqrt(MAX_PIXELS / (w * h)));
      var c = document.createElement('canvas');
      c.width = Math.max(8, Math.round(w * scale));
      c.height = Math.max(8, Math.round(h * scale));
      return { canvas: c, prints: prints, uploaded: false };
    }

    parts.forEach(function (p) {
      p.atlas = atlasFor(p);
      if (!p.atlas) return;
      var t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      p.texture = t;
    });

    var designCanvases = {};

    /* Repaint every printing part's atlas from the design state. Cheap enough
       to do on every commit: it is a handful of drawImage calls onto a canvas
       that is already the right size. */
    function paintAtlases(state) {
      parts.forEach(function (part) {
        if (!part.atlas) return;
        var a = part.atlas;
        var ctx = a.canvas.getContext('2d');
        ctx.clearRect(0, 0, a.canvas.width, a.canvas.height);

        a.prints.forEach(function (pr) {
          var zone = recipe.printZones.filter(function (z) { return z.id === pr.zoneId; })[0];
          if (!zone) return;
          var zstate = (state.zones && state.zones[zone.id]) || {};
          var rule = (recipe.textRules || [])
            .filter(function (r) { return r.zoneId === zone.id; })[0] || {};

          var hasPhoto = !!(zstate.photo && zstate.photo.image);
          var hasText = !!(zstate.text && zstate.text.value && zstate.text.value.trim());
          if (!hasPhoto && !hasText && !zone.background) return;

          if (!designCanvases[zone.id]) designCanvases[zone.id] = document.createElement('canvas');
          var design = G.Design.render({
            zone: zone, rule: rule, state: zstate, canvas: designCanvases[zone.id]
          });

          ctx.drawImage(design.canvas,
            pr.rect[0] * a.canvas.width,
            pr.rect[1] * a.canvas.height,
            pr.rect[2] * a.canvas.width,
            pr.rect[3] * a.canvas.height);
        });

        gl.bindTexture(gl.TEXTURE_2D, part.texture);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, a.canvas);
        a.uploaded = true;
      });
    }

    /* ---------------------------------------------------------------- camera */

    var cam = model.camera || {};
    var rest = {
      yaw: (cam.yawDeg == null ? 0 : cam.yawDeg) * Math.PI / 180,
      pitch: (cam.pitchDeg == null ? 8 : cam.pitchDeg) * Math.PI / 180
    };
    var view = { yaw: rest.yaw, pitch: rest.pitch };
    var fov = cam.fov || 30;
    var radius = Math.max(bounds.size[0], bounds.size[1], bounds.size[2]) / 2;
    var target = [bounds.mid[0], bounds.mid[1] + (cam.lift || 0) * radius, bounds.mid[2]];

    /* The floor. Everything that grounds the object measures from here: the
       ambient occlusion, the mirror plane and the contact shadow. */
    var floorY = bounds.lo[1];
    var span = Math.max(bounds.size[1], 1e-4);

    /* Framed against the shape of the canvas and the current tilt, not against
       the model's largest dimension. A cap is twice as wide as it is tall, and
       backing off far enough to fit its width into the HEIGHT of the frame left
       it a third of the size it should be.

       The bound is the upright cylinder around the model, which is exactly what
       a Y axis orbit cannot change, so turning a mug can never clip its handle.
       Tilting does change the vertical extent, and the second term is that
       projection, so a hard tilt eases the object away instead of cropping it.
       `dist` in a recipe is a nudge on top of all this, not the distance.

       The margin also has to leave room UNDER the object now, because there is
       a reflection down there and cropping it in half is worse than not having
       one. */
    var MARGIN = 1.2;
    var halfTall = bounds.size[1] / 2;
    var xzR = bounds.xzRadius;

    function frameDist(aspect) {
      var t = Math.tan(fov * Math.PI / 360);
      var cp = Math.abs(Math.cos(view.pitch)), sp = Math.abs(Math.sin(view.pitch));
      var halfV = halfTall * cp + xzR * sp;
      return Math.max(halfV / t, xzR / (t * aspect)) * MARGIN * (cam.dist || 1);
    }

    var dist = frameDist(1.3);   /* a sane value before the canvas is measured */

    var state = null;

    function eyeAt(d) {
      var cp = Math.cos(view.pitch);
      return [
        target[0] + d * Math.sin(view.yaw) * cp,
        target[1] + d * Math.sin(view.pitch),
        target[2] + d * Math.cos(view.yaw) * cp
      ];
    }

    /* ----------------------------------------------------------------- size */

    var cssW = 0, cssH = 0;

    function resize() {
      var r = canvas.getBoundingClientRect();
      var w = Math.max(1, Math.round(r.width));
      var h = Math.max(1, Math.round(r.height));
      if (!r.width || !r.height) return false;
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var pw = Math.round(w * dpr), ph = Math.round(h * dpr);
      if (canvas.width === pw && canvas.height === ph && cssW === w && cssH === h) return false;
      canvas.width = pw; canvas.height = ph;
      cssW = w; cssH = h;
      return true;
    }

    /* ----------------------------------------------------------------- draw */

    var REFLECT = model.reflect == null ? 0.30 : model.reflect;

    /* The shadow quad's attribute is generic index 0, which is also aPos, and
       disabling it after that pass turns aPos off for everything after it. So
       each mesh pass switches its own three on rather than trusting whatever
       the previous pass left behind. That is one line and it is the difference
       between a drawn object and a single degenerate triangle. */
    function meshAttribs() {
      gl.enableVertexAttribArray(aPos);
      gl.enableVertexAttribArray(aNormal);
      gl.enableVertexAttribArray(aUv);
    }

    function bindPart(part) {
      gl.bindBuffer(gl.ARRAY_BUFFER, part.pos);
      gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, part.nrm);
      gl.vertexAttribPointer(aNormal, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, part.uv);
      gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, part.idx);
    }

    function material(part) {
      var spec = part.spec;
      var hex = spec.colorPart && state && state.colors && state.colors[spec.colorPart];
      var rgb = hexToRgb(hex || spec.color || '#FFFFFF');
      gl.uniform3f(loc.uColor, rgb[0], rgb[1], rgb[2]);
      gl.uniform1f(loc.uGloss, spec.gloss == null ? 0.35 : spec.gloss);
      gl.uniform1f(loc.uRough, roughOf(spec));
      gl.uniform1f(loc.uMetal, spec.metal || 0);
      gl.uniform1f(loc.uCoat, spec.coat || 0);

      if (part.texture && part.atlas && part.atlas.uploaded) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, part.texture);
        gl.uniform1i(loc.uArt, 0);
        gl.uniform1f(loc.uHasArt, 1);
      } else {
        gl.uniform1f(loc.uHasArt, 0);
      }
    }

    function draw() {
      resize();
      if (!canvas.width || !canvas.height) return;

      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      var aspect = canvas.width / canvas.height;
      dist = frameDist(aspect);
      var proj = perspective(fov, aspect, radius * 0.05, dist + radius * 6);
      var eye = eyeAt(dist);
      var v = lookAt(eye, target, [0, 1, 0]);

      /* ---------------------------------------------------- 1. the reflection

         The same object, drawn through the floor plane. Two things have to
         change and forgetting either one is the whole effect:

           the winding, because a mirror swaps handedness, so what was the
           outside of the shell is now wound the other way and the default cull
           throws away exactly the surface that should be visible, and

           the alpha, which fades with height above the floor, because a real
           floor is not a mirror and a reflection that reaches the top of the
           object reads as a second object standing upside down.

         Skipped entirely when the camera has dropped to floor level, where a
         reflection would rise above the horizon and give the trick away. */
      if (REFLECT > 0.001 && eye[1] > floorY + span * 0.04) {
        gl.useProgram(prog);
        gl.uniformMatrix4fv(loc.uProj, false, proj);
        gl.uniformMatrix4fv(loc.uView, false, mirrored(v, floorY));
        gl.uniform3f(loc.uEye, eye[0], eye[1], eye[2]);
        gl.uniform1f(loc.uFloorY, floorY);
        gl.uniform1f(loc.uSpan, span);

        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.enable(gl.CULL_FACE);
        gl.cullFace(gl.FRONT);
        meshAttribs();

        parts.forEach(function (part) {
          material(part);
          /* One alpha for the whole part rather than a per pixel height fade.
             A fade inside the shader would need the mirrored depth, and the
             parts of these models are small enough that a per part value reads
             the same and costs nothing. The lower a part sits, the more of it
             the floor returns. */
          var mid = part.midY;
          var up = Math.max(0, Math.min(1, (mid - floorY) / span));
          gl.uniform1f(loc.uAlpha, REFLECT * (1 - up) * (1 - up * 0.4));
          bindPart(part);
          gl.drawElements(gl.TRIANGLES, part.count, part.type, 0);
        });

        gl.disable(gl.BLEND);
        gl.clear(gl.DEPTH_BUFFER_BIT);
      }

      /* --------------------------------------------------- 2. the contact shadow

         Over the reflection, under the object. Depth writing off so the object
         still sorts against itself normally.

         Culling is turned off for this one quad, and that is not tidiness. The
         quad lies flat and its triangles face downward, so with back face
         culling left on from the previous pass it was thrown away for every
         camera above the floor, which is every camera anybody uses. It survived
         the very first frame only because WebGL starts with culling off. */
      gl.disable(gl.CULL_FACE);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      gl.useProgram(shadowProg);
      gl.uniformMatrix4fv(sloc.uProj, false, proj);
      gl.uniformMatrix4fv(sloc.uView, false, v);
      gl.uniform3f(sloc.uCentre, bounds.mid[0], floorY - radius * 0.004, bounds.mid[2]);
      gl.uniform2f(sloc.uRadius, xzR * 1.7, xzR * 1.7);
      gl.uniform1f(sloc.uAlpha, model.shadow == null ? 0.34 : model.shadow);
      gl.bindBuffer(gl.ARRAY_BUFFER, shadowQuad);
      gl.enableVertexAttribArray(aXZ);
      gl.vertexAttribPointer(aXZ, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.disableVertexAttribArray(aXZ);
      gl.depthMask(true);
      gl.disable(gl.BLEND);

      /* ------------------------------------------------------- 3. the object

         Back faces are culled. Every part in this engine is a closed solid
         traced so that its outside is counterclockwise, so what gets thrown
         away is only ever surface facing the other way. Drawing both sides
         instead put the underside of a mug in a depth fight with its own
         silhouette and drew a dotted line along the bottom edge. The inside
         wall of an open vessel survives this: it is a front face, because the
         profile turns over the rim and comes back down. */
      gl.useProgram(prog);
      gl.uniformMatrix4fv(loc.uProj, false, proj);
      gl.uniformMatrix4fv(loc.uView, false, v);
      gl.uniform3f(loc.uEye, eye[0], eye[1], eye[2]);
      gl.uniform1f(loc.uFloorY, floorY);
      gl.uniform1f(loc.uSpan, span);
      gl.uniform1f(loc.uAlpha, 1);

      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);
      gl.frontFace(gl.CCW);
      meshAttribs();

      parts.forEach(function (part) {
        material(part);
        bindPart(part);
        gl.drawElements(gl.TRIANGLES, part.count, part.type, 0);
      });
    }

    /* ------------------------------------------------------------ the reveal

       One turn, eased, on the first draw. It orients: it shows in a second and
       a half that this thing can be turned, which no label does as well. Under
       reduced motion it is simply not there and the object is already at rest.
       rAF is the right clock here and only here, because everything else in
       this file draws the instant it is asked to. */

    var spinning = null;

    function reduced() {
      return window.matchMedia &&
             window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    function reveal() {
      if (reduced()) { view.yaw = rest.yaw; draw(); return; }
      var from = rest.yaw - Math.PI * 0.62;
      var t0 = null;
      var ms = 1100;
      cancelAnimationFrame(spinning);
      (function step(now) {
        if (t0 === null) t0 = now;
        var t = Math.min(1, (now - t0) / ms);
        var e = 1 - Math.pow(1 - t, 3);
        view.yaw = from + (rest.yaw - from) * e;
        draw();
        if (t < 1) spinning = requestAnimationFrame(step);
      })(performance.now());
    }

    /* ------------------------------------------------------------ turning it */

    var drag = null;

    /* One place that knows which way is which, so the pointer and the keyboard
       cannot drift apart. Pitch is clamped rather than wrapped: past about 50
       degrees either way the object is being looked at from underneath and the
       contact shadow gives the trick away. */
    function turn(dYaw, dPitch) {
      view.yaw += dYaw;
      view.pitch = Math.max(-0.42, Math.min(0.88, view.pitch + dPitch));
    }

    function stopReveal() {
      if (spinning) { cancelAnimationFrame(spinning); spinning = null; }
    }

    /* ------------------------------------------------------------- the flick

       Let go while still moving and the object keeps turning and slows down.
       It confirms: the thing has weight, so it is an object rather than a
       picture of one, and it is the cheapest way to show somebody they can spin
       it right round without a label saying so.

       The decay is per frame rather than per second on purpose. A frame rate
       independent decay is the correct thing and it is also the thing that
       makes a flick on a 120Hz phone feel different from the same flick on a
       60Hz laptop, because the sample interval of the gesture changes too. This
       is a five line feel, not a physics engine. */

    var flick = null;

    function coast(v0) {
      cancelAnimationFrame(flick);
      var v = v0;
      (function step() {
        v *= 0.94;
        if (Math.abs(v) < 0.0006) { flick = null; return; }
        view.yaw += v;
        draw();
        flick = requestAnimationFrame(step);
      })();
    }

    function stopFlick() {
      if (flick) { cancelAnimationFrame(flick); flick = null; }
    }

    canvas.addEventListener('pointerdown', function (e) {
      stopReveal();
      stopFlick();
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, v: 0 };
      canvas.setPointerCapture(e.pointerId);
      canvas.classList.add('is-turning');
    });

    /* The finger holds the object, not the camera. Drag right and the front of
       the thing goes right with you, which means the camera orbits the other
       way, so both of these subtract. Doing it the intuitive looking way round
       moves the object against the finger and feels broken within one gesture. */
    canvas.addEventListener('pointermove', function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      var dYaw = -(e.clientX - drag.x) * 0.011;
      turn(dYaw, (e.clientY - drag.y) * 0.008);
      /* A running average rather than the last sample. One sample at the moment
         a finger lifts is usually zero, because that is what a finger does just
         before it leaves the glass, and the flick dies on release every time. */
      drag.v = drag.v * 0.6 + dYaw * 0.4;
      drag.x = e.clientX; drag.y = e.clientY;
      draw();
    });

    function endDrag(e) {
      if (!drag || (e && e.pointerId !== drag.id)) return;
      var v = drag.v;
      drag = null;
      canvas.classList.remove('is-turning');
      if (!reduced() && Math.abs(v) > 0.004) coast(Math.max(-0.09, Math.min(0.09, v)));
    }
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);

    /* Turnable from the keyboard too, or the only way to see the back of a mug
       is with a mouse. Each key does exactly what dragging that way does: the
       arrow moves the object, so right sends the front of it to the right. */
    canvas.addEventListener('keydown', function (e) {
      var step = Math.PI / 12;
      if (e.key === 'ArrowLeft') turn(step, 0);
      else if (e.key === 'ArrowRight') turn(-step, 0);
      else if (e.key === 'ArrowUp') turn(0, -step / 2);
      else if (e.key === 'ArrowDown') turn(0, step / 2);
      else return;
      e.preventDefault();
      stopReveal();
      stopFlick();
      draw();
    });

    var lost = false;
    canvas.addEventListener('webglcontextlost', function (e) {
      e.preventDefault();
      lost = true;
      stopReveal();
      stopFlick();
      if (api.onLost) api.onLost();
    });

    /* -------------------------------------------------------------- the api */

    var api = {
      /* Repaint from a design state. `quick` skips the atlas rebuild, which is
         what a colour change wants: the artwork has not moved. */
      update: function (next, quick) {
        state = next;
        if (!quick) paintAtlases(state);
        draw();
      },
      draw: function () { draw(); },
      resize: function () { if (resize()) draw(); },
      reveal: reveal,
      reset: function () {
        stopReveal();
        stopFlick();
        view.yaw = rest.yaw;
        view.pitch = rest.pitch;
        draw();
      },
      /* Put the object at a named angle. The recipe camera is the angle a buyer
         opens on, which is chosen to show what the thing IS: a mug opens turned
         far enough to see the handle. A still picture of the artwork wants the
         print square to the lens instead, and that is a different number. */
      turnTo: function (yawDeg, pitchDeg) {
        stopReveal();
        stopFlick();
        if (yawDeg != null) view.yaw = yawDeg * Math.PI / 180;
        if (pitchDeg != null) view.pitch = Math.max(-0.42, Math.min(0.88, pitchDeg * Math.PI / 180));
        draw();
      },
      lost: function () { return lost; },
      onLost: null,
      canvas: canvas,
      destroy: function () {
        stopReveal();
        stopFlick();
        var ext = gl.getExtension('WEBGL_lose_context');
        if (ext) ext.loseContext();
      }
    };

    return api;
  };

})(window.Gifty = window.Gifty || {});
