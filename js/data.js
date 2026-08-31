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

  Data.clearCache = function () {
    memory = {};
    try {
      Object.keys(localStorage)
        .filter(function (k) { return k.indexOf(PREFIX) === 0; })
        .forEach(function (k) { localStorage.removeItem(k); });
    } catch (e) {}
  };

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
  Data.collection = function (name) {
    var cached = readCache(name);
    if (cached && Date.now() - cached.at < TTL) return Promise.resolve(cached.data);

    return get(name)
      .then(function (body) {
        var docs = (body.documents || []).map(Data.decodeDoc).filter(Boolean);
        writeCache(name, docs);
        return docs;
      })
      .catch(function (err) {
        /* Serving the last known catalogue beats serving nothing. The buyer is
           never charged from it: the order is priced again server side. */
        if (cached) return cached.data;
        throw err;
      });
  };

  Data.doc = function (path) {
    var name = path.replace(/\//g, '.');
    var cached = readCache(name);
    if (cached && Date.now() - cached.at < TTL) return Promise.resolve(cached.data);

    return get(path)
      .then(function (body) {
        var doc = Data.decodeDoc(body);
        writeCache(name, doc);
        return doc;
      })
      .catch(function (err) {
        if (cached) return cached.data;
        throw err;
      });
  };

})(window.Gifty = window.Gifty || {});
