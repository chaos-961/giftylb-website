/* Gifty. Recipe loading and validation.
 *
 * A product is data. This file is the only thing that knows where that data
 * comes from, which is why moving the catalog to a database in a later phase is
 * a change to loadRecipe and to nothing else.
 */
(function (G) {
  'use strict';

  var R = G.Recipe = {};


  /* Release version, read from the page. Recipes hold clean asset paths so a
     release does not mean editing every JSON file, but the assets still have to
     cache bust or a changed product photo goes stale in the wild. So the loader
     stamps the version on. check-release.mjs proves the meta matches VERSION. */
  R.version = (function () {
    var m = document.querySelector('meta[name="version"]');
    return m ? m.content : '';
  })();

  R.bust = function (url) {
    if (!R.version || !url || /^(data:|https?:)/.test(url) || url.indexOf('?') >= 0) return url;
    return url + '?v=' + R.version;
  };

  /* Firestore cannot nest an array inside an array, and this format is full of
     lists of points: a quad is four pairs, a lathe profile is a traced outline,
     a tube path is a swept line. Every one of them is stored as {x,y} maps and
     turned back into the engine's own [[x,y]] here, so the wire format never
     reaches the renderer and a recipe read from the database is identical to
     one read from the bundle.

     The model blocks were missed when the 3D engine landed, which is why
     seeding failed on the first product it reached. Anything added to a recipe
     that is a list of points belongs in this list too. */
  function points(list) {
    return (list && list.length && !Array.isArray(list[0]))
      ? list.map(function (p) { return [p.x, p.y]; })
      : list;
  }

  R.normalize = function (recipe) {
    (recipe.printZones || []).forEach(function (z) {
      if (z.warp && z.warp.quad) z.warp.quad = points(z.warp.quad);
    });
    ((recipe.model && recipe.model.parts) || []).forEach(function (part) {
      if (part.profile) part.profile = points(part.profile);
      if (part.path) part.path = points(part.path);
    });
    return recipe;
  };

  R.load = function (id) {
    return G.Data.doc('products/' + id).then(function (recipe) {
      if (!recipe) throw new Error('there is no product ' + id);
      R.validate(R.normalize(recipe));
      return recipe;
    });
  };

  /* The shop wants the whole catalogue, which is one request rather than five. */
  R.all = function () {
    return G.Data.collection('products').then(function (list) {
      list.forEach(function (r) { R.validate(R.normalize(r)); });
      return list;
    });
  };

  /* Fails loudly and early. A recipe typo that reaches the renderer produces a
     blank canvas and an afternoon of confusion, so it gets caught here instead. */
  R.validate = function (recipe) {
    var problems = [];
    var need = function (cond, msg) { if (!cond) problems.push(msg); };

    need(recipe.id, 'missing id');
    need(recipe.views && recipe.views.length, 'needs at least one view');
    need(typeof recipe.basePrice === 'number', 'basePrice must be a number');

    var viewIds = (recipe.views || []).map(function (v) { return v.id; });
    (recipe.views || []).forEach(function (v) {
      need(v.w > 0 && v.h > 0, 'view ' + v.id + ' needs w and h');
      need(!!v.baseImage, 'view ' + v.id + ' needs a baseImage');
    });

    (recipe.colorParts || []).forEach(function (p) {
      need(viewIds.indexOf(p.viewId) >= 0, 'colorPart ' + p.id + ' points at an unknown view');
      need(!!p.maskUrl, 'colorPart ' + p.id + ' needs a maskUrl');
      need(!!p.default, 'colorPart ' + p.id + ' needs a default colour');
    });

    var zoneIds = [];
    (recipe.printZones || []).forEach(function (z) {
      zoneIds.push(z.id);
      need(viewIds.indexOf(z.viewId) >= 0, 'zone ' + z.id + ' points at an unknown view');
      need(!!z.rect, 'zone ' + z.id + ' needs a rect');
      need(!!(z.warp && z.warp.type), 'zone ' + z.id + ' needs a warp type');
      need(z.widthMm > 0 && z.heightMm > 0, 'zone ' + z.id + ' needs real millimetres');
      need(z.minDpi > 0, 'zone ' + z.id + ' needs a minDpi');
    });

    (recipe.textRules || []).forEach(function (t) {
      need(zoneIds.indexOf(t.zoneId) >= 0, 'textRule points at unknown zone ' + t.zoneId);
    });

    (recipe.pricing || []).forEach(function (p) {
      need(typeof p.amount === 'number', 'pricing rule ' + p.id + ' needs an amount');
      need(!!p.when, 'pricing rule ' + p.id + ' needs a when clause');
    });

    if (problems.length) {
      throw new Error('recipe ' + (recipe.id || '?') + ' is not valid:\n  ' + problems.join('\n  '));
    }
    return true;
  };

  /* Every image a recipe refers to, in one list, so the customizer can show a
     single loading state instead of popping in piece by piece. */
  R.imageUrls = function (recipe) {
    var urls = [];
    (recipe.views || []).forEach(function (v) {
      if (v.baseImage) urls.push(v.baseImage);
      if (v.glossImage) urls.push(v.glossImage);
    });
    (recipe.colorParts || []).forEach(function (p) { urls.push(p.maskUrl); });
    (recipe.printZones || []).forEach(function (z) {
      if (z.warp && z.warp.type === 'map' && z.warp.url) urls.push(z.warp.url);
    });
    return urls.filter(function (u, i, a) { return u && a.indexOf(u) === i; });
  };

  R.loadImage = function (url) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.decoding = 'sync';
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('could not load ' + url)); };
      img.src = R.bust(url);
    });
  };

  R.loadImages = function (recipe) {
    var urls = R.imageUrls(recipe);
    return Promise.all(urls.map(R.loadImage)).then(function (imgs) {
      var map = {};
      urls.forEach(function (u, i) { map[u] = imgs[i]; });
      return map;
    });
  };

  /* The blank starting design for a recipe. */
  R.initialState = function (recipe) {
    var state = { productId: recipe.id, colors: {}, zones: {} };
    (recipe.colorParts || []).forEach(function (p) { state.colors[p.id] = p.default; });
    (recipe.printZones || []).forEach(function (z) {
      var rule = (recipe.textRules || []).filter(function (r) { return r.zoneId === z.id; })[0];
      state.zones[z.id] = {
        photo: null,
        text: {
          value: '',
          font: (rule && rule.defaultFont) || 'display',
          color: (rule && rule.defaultColor) || '#14201F',
          size: 0.2,
          y: 0.5
        }
      };
    });
    return state;
  };

})(window.Gifty = window.Gifty || {});
