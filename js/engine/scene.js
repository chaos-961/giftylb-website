/* Gifty engine. The three dimensional preview.
 *
 * Draws the real object. Same rule as everywhere else in the engine: this file
 * has never heard of a mug. It takes a `model` block out of a recipe, asks
 * js/engine/mesh.js for the geometry, paints the buyer's artwork onto the parts
 * the recipe says are printable, and lights it.
 *
 * There is no library under this. WebGL is the whole dependency, the shaders
 * are forty lines, and the project's standing rule is no build step and no
 * vendored runtime, so a three megabyte scene graph was never on the table.
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
    '  vNormal = aNormal;',
    '  vPos = aPos;',
    '  vUv = aUv;',
    '  gl_Position = uProj * uView * vec4(aPos, 1.0);',
    '}'
  ].join('\n');

  /* Lit in linear space and written back out with a gamma, because a deep teal
     mug shaded straight in sRGB goes muddy in the midtones and grey in the
     shadow. Three lights: a key from the upper left front, a cool fill from the
     right, and a dim bounce from below so the underside is not a black hole. */
  var FRAG = [
    'precision mediump float;',
    'varying vec3 vNormal;',
    'varying vec3 vPos;',
    'varying vec2 vUv;',
    'uniform vec3 uColor;',
    'uniform sampler2D uArt;',
    'uniform float uHasArt;',
    'uniform float uGloss;',
    'uniform float uShine;',
    'uniform float uMetal;',
    'uniform vec3 uEye;',

    'vec3 toLinear(vec3 c) { return pow(c, vec3(2.2)); }',
    'vec3 toSrgb(vec3 c) { return pow(c, vec3(1.0 / 2.2)); }',

    'void main() {',
    '  vec3 N = normalize(vNormal);',
    /* A mug is open at the top, so the inside of the wall faces away from us.
       Flipping on the back face is what stops the interior reading as a hole. */
    '  if (!gl_FrontFacing) N = -N;',
    '  vec3 V = normalize(uEye - vPos);',

    '  vec3 albedo = uColor;',
    '  if (uHasArt > 0.5 && vUv.x >= 0.0 && vUv.x <= 1.0 && vUv.y >= 0.0 && vUv.y <= 1.0) {',
    '    vec4 art = texture2D(uArt, vUv);',
    '    albedo = mix(albedo, art.rgb, art.a);',
    '  }',
    '  albedo = toLinear(albedo);',

    '  vec3 L1 = normalize(vec3(-0.40, 0.78, 0.62));',
    '  vec3 L2 = normalize(vec3( 0.82, 0.18, 0.42));',
    '  vec3 L3 = normalize(vec3( 0.10, -0.85, 0.30));',

    '  float d1 = max(dot(N, L1), 0.0);',
    '  float d2 = max(dot(N, L2), 0.0);',
    '  float d3 = max(dot(N, L3), 0.0);',

    /* A sky and a floor rather than one flat ambient, so the top of a white
       object is not the same value as its underside. */
    '  vec3 sky = toLinear(vec3(0.95, 0.98, 0.99));',
    '  vec3 floorC = toLinear(vec3(0.84, 0.82, 0.78));',
    '  vec3 amb = mix(floorC, sky, N.y * 0.5 + 0.5) * 0.40;',

    '  vec3 lit = albedo * (amb',
    '    + d1 * 0.88 * toLinear(vec3(1.00, 0.99, 0.96))',
    '    + d2 * 0.24 * toLinear(vec3(0.88, 0.94, 1.00))',
    '    + d3 * 0.09);',

    '  vec3 H1 = normalize(L1 + V);',
    '  vec3 H2 = normalize(L2 + V);',
    '  float s1 = pow(max(dot(N, H1), 0.0), uShine);',
    '  float s2 = pow(max(dot(N, H2), 0.0), max(uShine * 0.5, 2.0));',
    /* Glaze. The rim of a curved object catches the room, and without this a
       white mug on a white page has no silhouette at all. */
    '  float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0);',
    '  vec3 tint = mix(vec3(1.0), albedo, uMetal);',
    '  vec3 spec = tint * uGloss * (s1 + s2 * 0.30 + fres * 0.45);',

    '  vec3 col = lit + spec;',
    /* Roll the highlights off instead of clipping them to flat white. */
    '  col = col / (col + vec3(0.88)) * 1.88;',
    '  gl_FragColor = vec4(toSrgb(col), 1.0);',
    '}'
  ].join('\n');

  /* The contact shadow. A quad on the floor with a soft radial falloff, which
     is cheaper than a shadow map by three orders of magnitude and is the one
     cue that stops the object floating. */
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
    '  float d = length(vXZ);',
    '  float a = smoothstep(1.0, 0.05, d) * uAlpha;',
    /* Premultiplied, to match the blend mode the canvas is composited with. */
    '  gl_FragColor = vec4(vec3(0.055, 0.098, 0.094) * a, a);',
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

  /* ------------------------------------------------------------------- utils */

  function hexToRgb(hex) {
    var h = String(hex || '#ffffff').replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    if (isNaN(n)) return [1, 1, 1];
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
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
    ['uProj', 'uView', 'uColor', 'uArt', 'uHasArt', 'uGloss', 'uShine', 'uMetal', 'uEye']
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
      return {
        spec: spec,
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

    /* Framed against the shape of the canvas and the current tilt, not against
       the model's largest dimension. A cap is twice as wide as it is tall, and
       backing off far enough to fit its width into the HEIGHT of the frame left
       it a third of the size it should be.

       The bound is the upright cylinder around the model, which is exactly what
       a Y axis orbit cannot change, so turning a mug can never clip its handle.
       Tilting does change the vertical extent, and the second term is that
       projection, so a hard tilt eases the object away instead of cropping it.
       `dist` in a recipe is a nudge on top of all this, not the distance. */
    var MARGIN = 1.13;
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
    var dirty = true;

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

      /* The floor first, with depth writing off so the object still sorts
         against itself normally.

         Culling is turned off for this one quad, and that is not tidiness. The
         quad lies flat and its triangles face downward, so with back face
         culling left on from the previous frame it was thrown away for every
         camera above the floor, which is every camera anybody uses. It survived
         the very first frame only because WebGL starts with culling off. */
      gl.disable(gl.CULL_FACE);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      gl.useProgram(shadowProg);
      gl.uniformMatrix4fv(sloc.uProj, false, proj);
      gl.uniformMatrix4fv(sloc.uView, false, v);
      gl.uniform3f(sloc.uCentre, bounds.mid[0], bounds.lo[1] - radius * 0.004, bounds.mid[2]);
      gl.uniform2f(sloc.uRadius, xzR * 1.55, xzR * 1.55);
      gl.uniform1f(sloc.uAlpha, model.shadow == null ? 0.26 : model.shadow);
      gl.bindBuffer(gl.ARRAY_BUFFER, shadowQuad);
      gl.enableVertexAttribArray(aXZ);
      gl.vertexAttribPointer(aXZ, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.disableVertexAttribArray(aXZ);
      gl.depthMask(true);
      gl.disable(gl.BLEND);

      gl.useProgram(prog);
      gl.uniformMatrix4fv(loc.uProj, false, proj);
      gl.uniformMatrix4fv(loc.uView, false, v);
      gl.uniform3f(loc.uEye, eye[0], eye[1], eye[2]);

      /* Back faces are culled. Every part in this engine is a closed solid
         traced so that its outside is counterclockwise, so what gets thrown
         away is only ever surface facing the other way. Drawing both sides
         instead put the underside of a mug in a depth fight with its own
         silhouette and drew a dotted line along the bottom edge. The inside
         wall of an open vessel survives this: it is a front face, because the
         profile turns over the rim and comes back down. */
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);
      gl.frontFace(gl.CCW);

      gl.enableVertexAttribArray(aPos);
      gl.enableVertexAttribArray(aNormal);
      gl.enableVertexAttribArray(aUv);

      parts.forEach(function (part) {
        var spec = part.spec;
        var hex = spec.colorPart && state && state.colors && state.colors[spec.colorPart];
        var rgb = hexToRgb(hex || spec.color || '#FFFFFF');
        gl.uniform3f(loc.uColor, rgb[0], rgb[1], rgb[2]);
        gl.uniform1f(loc.uGloss, spec.gloss == null ? 0.35 : spec.gloss);
        gl.uniform1f(loc.uShine, spec.shine == null ? 40 : spec.shine);
        gl.uniform1f(loc.uMetal, spec.metal || 0);

        if (part.texture && part.atlas && part.atlas.uploaded) {
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, part.texture);
          gl.uniform1i(loc.uArt, 0);
          gl.uniform1f(loc.uHasArt, 1);
        } else {
          gl.uniform1f(loc.uHasArt, 0);
        }

        gl.bindBuffer(gl.ARRAY_BUFFER, part.pos);
        gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, part.nrm);
        gl.vertexAttribPointer(aNormal, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, part.uv);
        gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, part.idx);
        gl.drawElements(gl.TRIANGLES, part.count, part.type, 0);
      });

      dirty = false;
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

    canvas.addEventListener('pointerdown', function (e) {
      stopReveal();
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
      canvas.classList.add('is-turning');
    });

    /* The finger holds the object, not the camera. Drag right and the front of
       the thing goes right with you, which means the camera orbits the other
       way, so both of these subtract. Doing it the intuitive looking way round
       moves the object against the finger and feels broken within one gesture. */
    canvas.addEventListener('pointermove', function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      turn(-(e.clientX - drag.x) * 0.011, (e.clientY - drag.y) * 0.008);
      drag.x = e.clientX; drag.y = e.clientY;
      draw();
    });

    function endDrag(e) {
      if (!drag || (e && e.pointerId !== drag.id)) return;
      drag = null;
      canvas.classList.remove('is-turning');
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
      draw();
    });

    var lost = false;
    canvas.addEventListener('webglcontextlost', function (e) {
      e.preventDefault();
      lost = true;
      if (api.onLost) api.onLost();
    });

    /* -------------------------------------------------------------- the api */

    var api = {
      /* Repaint from a design state. `quick` skips the atlas rebuild, which is
         what a colour change wants: the artwork has not moved. */
      update: function (next, quick) {
        state = next;
        if (!quick) paintAtlases(state);
        dirty = true;
        draw();
      },
      draw: function () { draw(); },
      resize: function () { if (resize()) draw(); },
      reveal: reveal,
      reset: function () {
        stopReveal();
        view.yaw = rest.yaw;
        view.pitch = rest.pitch;
        draw();
      },
      lost: function () { return lost; },
      onLost: null,
      canvas: canvas,
      destroy: function () {
        stopReveal();
        var ext = gl.getExtension('WEBGL_lose_context');
        if (ext) ext.loseContext();
      }
    };

    return api;
  };

})(window.Gifty = window.Gifty || {});
