/* Gifty. The catalogue, read from the database.
 *
 * Products, templates and settings live in one place, because the admin edits
 * them and the order rule prices from them. A second copy in the repo would be
 * a second answer to "what does a mug cost", and the two would drift the first
 * time someone changed a price.
 *
 * No SDK. The REST endpoint returns the same documents for a plain fetch, and
 * the whole storefront budget is 120KB, most of which the customizer wants.
 * This file is the only thing that knows where the data comes from.
 *
 * There is one fallback, and it exists because a shop that is briefly out of
 * date beats a shop that is a blank page. When a live read fails or comes back
 * empty, the bundled data/catalogue.json is served instead. The database always
 * wins when it has anything to say, the bundle is only ever fetched when it
 * does not, and no buyer is ever charged from it: the Worker re-derives every
 * price from the live documents and the order rule bounds it from the same
 * place. tools/build-catalogue.mjs builds the bundle from the very seed files
 * the seeder pushes, and check-release.mjs refuses a release where the two
 * have drifted.
 */
(function (G) {
  'use strict';

  var Data = G.Data = {};

  var project = (window.GIFTY_CONFIG && window.GIFTY_CONFIG.projectId) || '';
  var key = (window.GIFTY_CONFIG && window.GIFTY_CONFIG.apiKey) || '';

  Data.base = 'https://firestore.googleapis.com/v1/projects/' + project +
              '/databases/(default)/documents';

  /* Point the whole storefront at an emulator without touching a call site. */
  if (window.GIFTY_FIRESTORE_BASE) Data.base = window.GIFTY_FIRESTORE_BASE;

  /* --------------------------------------------------------------- decoding

     Firestore's REST shape is typed: every leaf is wrapped in a one key object
     naming its type. This turns a document back into a plain object so nothing
     downstream has to know the wire format. */

  Data.decode = function (v) {
    if (!v || typeof v !== 'object') return null;
    if ('stringValue' in v) return v.stringValue;
    if ('integerValue' in v) return Number(v.integerValue);
    if ('doubleValue' in v) return Number(v.doubleValue);
    if ('booleanValue' in v) return v.booleanValue;
    if ('nullValue' in v) return null;
    if ('timestampValue' in v) return v.timestampValue;
    if ('arrayValue' in v) return ((v.arrayValue && v.arrayValue.values) || []).map(Data.decode);
    if ('mapValue' in v) return Data.fields((v.mapValue && v.mapValue.fields) || {});
    return null;
  };

  Data.fields = function (fields) {
    var out = {};
    Object.keys(fields || {}).forEach(function (k) { out[k] = Data.decode(fields[k]); });
    return out;
  };

  Data.decodeDoc = function (doc) {
    if (!doc || !doc.name) return null;
    var out = Data.fields(doc.fields);
    out.id = doc.name.slice(doc.name.lastIndexOf('/') + 1);
    return out;
  };

  /* ----------------------------------------------------------------- cache

     Sixty seconds. Long enough that moving between the shop, a design and the
     cart costs one read, short enough that a price edit in the admin reaches
     buyers within a minute. The order is priced again from live data when it
     is placed, so a stale client price is caught rather than charged. */

  var TTL = 60000;
  var PREFIX = 'gifty.cat.';
  var memory = {};

  function readCache(name) {
    if (memory[name]) return memory[name];
    try {
      var raw = localStorage.getItem(PREFIX + name);
      if (!raw) return null;
      var box = JSON.parse(raw);
      if (!box || !box.at) return null;
      memory[name] = box;
      return box;
    } catch (e) { return null; }
  }

  function writeCache(name, data) {
    var box = { at: Date.now(), data: data };
    memory[name] = box;
    try { localStorage.setItem(PREFIX + name, JSON.stringify(box)); }
    catch (e) { /* a full store must never stop the shop rendering */ }
  }

  /* An empty list is never an answer, whether it came from the database a
     moment ago or from this cache seven hours ago. Builds before the fallback
     existed happily cached an empty collection against an unseeded database,
     and honouring those is how a returning visitor got a blank shop out of a
     bundle that was sitting right there. Ignoring them lets the poisoned entry
     age out on its own rather than needing a migration. */
  function usable(cached) {
    return !!(cached && Array.isArray(cached.data) && cached.data.length);
  }

  Data.clearCache = function () {
    memory = {};
    try {
      Object.keys(localStorage)
        .filter(function (k) { return k.indexOf(PREFIX) === 0; })
        .forEach(function (k) { localStorage.removeItem(k); });
    } catch (e) {}
  };

  /* -------------------------------------------------------------- fallback

     Lazy, and fetched at most once per page. A storefront talking to a healthy
     database never asks for this file at all, so the happy path pays nothing
     for it. */

  var bundle = null;

  /* Worked out from this script's own address, not from the page's. A plain
     relative path is resolved against the document, so the same string means
     /data/catalogue.json on the shop and /admin/data/catalogue.json in the
     dashboard, and one of those does not exist. Taking the site root off this
     file's own src is also what keeps it right when the site is served from a
     subpath rather than from the root of a domain. */
  Data.bundleUrl = (function () {
    var m = document.querySelector('meta[name="version"]');
    var v = m ? m.content : '';
    var base = 'data/catalogue.json';
    var here = document.currentScript && document.currentScript.src;
    if (here) {
      var cut = here.indexOf('/js/data.js');
      if (cut >= 0) base = here.slice(0, cut + 1) + 'data/catalogue.json';
    }
    return base + (v ? '?v=' + v : '');
  })();

  function loadBundle() {
    if (bundle) return bundle;
    /* Plain caching, not force-cache. The ?v= is what busts this file, and
       force-cache would keep serving a build's catalogue after the file under
       that same version had been rebuilt. */
    bundle = fetch(Data.bundleUrl)
      .then(function (res) {
        if (!res.ok) throw new Error('catalogue ' + res.status);
        return res.json();
      })
      .catch(function () {
        /* Let the next caller try again rather than caching the failure. */
        bundle = null;
        return null;
      });
    return bundle;
  }

  /* Named once so the reason shows up in one place in a console, and so the
     admin can tell "the database is empty" from "the database is down". */
  Data.usingBundle = false;

  function fromBundle(pick) {
    return loadBundle().then(function (cat) {
      if (!cat) return null;
      Data.usingBundle = true;
      return pick(cat);
    });
  }

  function bundleCollection(name) {
    return fromBundle(function (cat) {
      if (name === 'products') return cat.products || [];
      if (name === 'templates') return cat.templates || [];
      if (name === 'settings') return cat.settings ? [assignId(cat.settings, 'global')] : [];
      return [];
    });
  }

  function bundleDoc(path) {
    var slash = path.indexOf('/');
    var col = path.slice(0, slash);
    var id = path.slice(slash + 1);
    return bundleCollection(col).then(function (list) {
      if (!list) return null;
      var hit = list.filter(function (d) { return d && d.id === id; })[0];
      return hit || null;
    });
  }

  function assignId(doc, id) {
    var out = {};
    Object.keys(doc).forEach(function (k) { out[k] = doc[k]; });
    out.id = id;
    return out;
  }

  /* ----------------------------------------------------------------- reads */

  function url(path) {
    return Data.base + '/' + path + (key ? '?key=' + encodeURIComponent(key) : '');
  }

  function get(path) {
    return fetch(url(path), { cache: 'no-store' }).then(function (res) {
      if (!res.ok) throw new Error(path + ' returned ' + res.status);
      return res.json();
    });
  }

  /* A whole collection in one request, which is what the shop wants: five
     products is one round trip, not five. */
  /* One order, by its number, with no cache and no fallback.

     A get, deliberately, not a query. The rules allow reading a single order
     document and refuse to list the collection, so this is the only shape that
     works, and that asymmetry is what lets a tracking link carry no login
     without handing anyone the whole order book. A 404 here is a wrong number,
     which is a real answer and not an error. */
  Data.orderByNumber = function (number) {
    var path = 'orders/' + encodeURIComponent(String(number).trim().toUpperCase());
    return fetch(url(path), { cache: 'no-store' }).then(function (res) {
      if (res.status === 404 || res.status === 403) return null;
      if (!res.ok) throw new Error(path + ' returned ' + res.status);
      return res.json().then(Data.decodeDoc);
    });
  };

  Data.collection = function (name) {
    var cached = readCache(name);
    if (usable(cached) && Date.now() - cached.at < TTL) return Promise.resolve(cached.data);

    return get(name)
      .then(function (body) {
        var docs = (body.documents || []).map(Data.decodeDoc).filter(Boolean);
        /* An empty collection is not an answer, it is a database that has not
           been seeded yet. Treated exactly like a failed read. */
        if (!docs.length) throw new Error(name + ' is empty');
        writeCache(name, docs);
        return docs;
      })
      .catch(function (err) {
        /* Serving the last known catalogue beats serving nothing. The buyer is
           never charged from it: the order is priced again server side. */
        if (usable(cached)) return cached.data;
        return bundleCollection(name).then(function (docs) {
          if (docs && docs.length) return docs;
          throw err;
        });
      });
  };

  /* One document, resolved through its collection.

     Not a document read, on purpose. Asking Firestore for products/mug on a
     database that has not been seeded is a 404, and a 404 on fetch is printed
     to the console by the browser itself: no catch can silence it, so an
     unseeded shop filled the console with red while working perfectly through
     the fallback. Listing the collection returns 200 with an empty body in
     exactly the same situation. It is also fewer requests: the shop, a design
     and the cart share one cached list rather than reading a document each. */

  var CATALOGUE = { products: 1, templates: 1, settings: 1 };

  Data.doc = function (path) {
    var slash = path.indexOf('/');
    var col = slash < 0 ? path : path.slice(0, slash);
    var id = slash < 0 ? '' : path.slice(slash + 1);

    if (CATALOGUE[col]) {
      return Data.collection(col).then(function (list) {
        var hit = (list || []).filter(function (d) { return d && d.id === id; })[0];
        if (hit) return hit;
        throw new Error('there is no ' + path);
      });
    }

    var name = path.replace(/\//g, '.');
    var cached = readCache(name);
    if (cached && cached.data && Date.now() - cached.at < TTL) return Promise.resolve(cached.data);

    return get(path)
      .then(function (body) {
        var doc = Data.decodeDoc(body);
        writeCache(name, doc);
        return doc;
      })
      .catch(function (err) {
        if (cached && cached.data) return cached.data;
        return bundleDoc(path).then(function (doc) {
          if (doc) return doc;
          throw err;
        });
      });
  };

})(window.Gifty = window.Gifty || {});
