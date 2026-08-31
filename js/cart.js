/* Gifty. The cart.
 *
 * No account, ever. The cart lives in this browser, which is what makes it
 * survive a refresh, a closed tab and a flat signal, and what makes it cost
 * nothing to read. Anonymous auth would add continuity across devices, not
 * across a refresh, and it is switched off on the project, so it is not the
 * store here.
 *
 * A design is JSON plus one downscaled photo per zone, exactly the shape the
 * customizer autosaves, so an item can be reopened for editing without any
 * translation. P4 takes the same object, uploads the photo and posts the order.
 */
(function (G) {
  'use strict';

  var Cart = G.Cart = {};

  var KEY = 'gifty.cart.v1';
  var subs = [];
  var data = null;

  function blank() { return { zone: null, items: [] }; }

  function read() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return blank();
      var parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.items)) return blank();
      return parsed;
    } catch (e) { return blank(); }
  }

  function state() {
    if (!data) data = read();
    return data;
  }

  function write() {
    localStorage.setItem(KEY, JSON.stringify(data));
  }

  function announce() {
    paintBadges();
    subs.forEach(function (fn) { try { fn(Cart.items()); } catch (e) {} });
  }

  /* ------------------------------------------------------------ photo sizing

     localStorage is about 5MB, and one phone photo kept at the customizer's
     autosave size is most of a megabyte. Rather than refuse the third item,
     shrink what is already saved and keep going: a cart photo only has to
     survive until P4 uploads it, and the resolution gate re-reads the pixels
     that are actually there, so the buyer is never told the print is fine when
     it has quietly been shrunk. */

  var LADDER = [1400, 1000, 700];

  function reencode(src, maxEdge) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        var k = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
        if (k >= 1) return resolve(src);
        var c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * k);
        c.height = Math.round(img.naturalHeight * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        try { resolve(c.toDataURL('image/jpeg', 0.84)); } catch (e) { resolve(src); }
      };
      img.onerror = function () { resolve(src); };
      img.src = src;
    });
  }

  function eachPhoto(items, fn) {
    var jobs = [];
    items.forEach(function (item) {
      var zones = (item.snapshot && item.snapshot.zones) || {};
      Object.keys(zones).forEach(function (id) {
        var p = zones[id].photo;
        if (p && p.saveSrc) jobs.push(fn(p));
      });
    });
    return Promise.all(jobs);
  }

  /* Write, and if the store is full, shrink and try again. Resolves false only
     when even the smallest copy will not fit. */
  function persist() {
    try { write(); return Promise.resolve(true); }
    catch (e) { /* fall through to the ladder */ }

    var step = 0;
    function attempt() {
      if (step >= LADDER.length) return Promise.resolve(false);
      var edge = LADDER[step++];
      return eachPhoto(data.items, function (p) {
        return reencode(p.saveSrc, edge).then(function (src) { p.saveSrc = src; });
      }).then(function () {
        try { write(); return true; }
        catch (e2) { return attempt(); }
      });
    }
    return attempt();
  }

  /* ------------------------------------------------------------------- read */

  Cart.items = function () { return state().items.slice(); };
  Cart.count = function () {
    return state().items.reduce(function (n, i) { return n + (i.qty || 1); }, 0);
  };
  Cart.subtotal = function () {
    return Math.round(state().items.reduce(function (sum, i) {
      return sum + i.unitPrice * (i.qty || 1);
    }, 0) * 100) / 100;
  };
  Cart.find = function (id) {
    return state().items.filter(function (i) { return i.id === id; })[0] || null;
  };

  /* The slowest thing in the cart is what the whole cart waits for. */
  Cart.leadTimeDays = function () {
    return state().items.reduce(function (m, i) { return Math.max(m, i.leadTimeDays || 1); }, 1);
  };

  Cart.zone = function () { return state().zone; };
  Cart.setZone = function (id) {
    state().zone = id;
    return persist().then(function (ok) { announce(); return ok; });
  };

  /* ------------------------------------------------------------------ write */

  function makeId() {
    return 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  Cart.add = function (item) {
    var entry = {
      id: makeId(),
      productId: item.productId,
      productName: item.productName,
      leadTimeDays: item.leadTimeDays,
      qty: 1,
      unitPrice: item.unitPrice,
      lines: item.lines || [],
      thumb: item.thumb || null,
      snapshot: item.snapshot,
      addedAt: Date.now()
    };
    state().items.push(entry);
    return persist().then(function (ok) {
      if (!ok) { data.items.pop(); write(); }
      announce();
      return ok ? entry : null;
    });
  };

  /* Re-opened from the cart, edited, saved back. Keeps its place in the list
     and its quantity, because neither of those is what the buyer changed. */
  Cart.replace = function (id, item) {
    var existing = Cart.find(id);
    if (!existing) return Cart.add(item);
    existing.productName = item.productName;
    existing.leadTimeDays = item.leadTimeDays;
    existing.unitPrice = item.unitPrice;
    existing.lines = item.lines || [];
    existing.thumb = item.thumb || existing.thumb;
    existing.snapshot = item.snapshot;
    return persist().then(function (ok) { announce(); return ok ? existing : null; });
  };

  Cart.setQty = function (id, qty) {
    var item = Cart.find(id);
    if (!item) return Promise.resolve(false);
    item.qty = Math.max(1, Math.min(20, Math.round(qty) || 1));
    return persist().then(function (ok) { announce(); return ok; });
  };

  Cart.remove = function (id) {
    data = state();
    data.items = data.items.filter(function (i) { return i.id !== id; });
    return persist().then(function (ok) { announce(); return ok; });
  };

  Cart.clear = function () {
    data = blank();
    return persist().then(function (ok) { announce(); return ok; });
  };

  Cart.subscribe = function (fn) { subs.push(fn); return fn; };

  /* ------------------------------------------------------------ header badge

     Painted from the store on every page, so the count is right the moment the
     page renders rather than one frame later. */

  function paintBadges() {
    var n = Cart.count();
    var nodes = document.querySelectorAll('[data-cart-count]');
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].textContent = String(n);
      nodes[i].hidden = n === 0;
      var link = nodes[i].closest('a');
      if (link) {
        link.setAttribute('aria-label', n === 1 ? 'Cart, 1 item' : 'Cart, ' + n + ' items');
      }
    }
  }

  /* A second tab that empties the cart must not leave this one showing three
     items and a total that no longer exists. */
  window.addEventListener('storage', function (e) {
    if (e.key !== KEY) return;
    data = read();
    announce();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', paintBadges);
  } else {
    paintBadges();
  }

})(window.Gifty = window.Gifty || {});
