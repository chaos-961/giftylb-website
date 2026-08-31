/* Gifty. The gift box, as arithmetic.
 *
 * A box is not a product with things inside it. It is a group: two to four
 * items the buyer already designed, plus one gift-box item carrying the ribbon
 * and the card, all sharing a boxId. That is what keeps the order rule intact,
 * because every line still prices against its own product document.
 *
 * The saving is the only new number, so it lives here on its own, pure, with no
 * DOM and no storage. worker/src/price.js holds the same function in module
 * form and tools/test-parity.mjs runs both over every combination a buyer can
 * reach. Never edit one of the two without the other.
 */
(function (G) {
  'use strict';

  var Bundle = G.Bundle = {};

  Bundle.DEFAULTS = { productId: 'gift-box', minItems: 2, maxItems: 4, discountPercent: 10 };

  Bundle.config = function (settings) {
    var s = (settings && settings.giftBox) || {};
    return {
      productId: s.productId || Bundle.DEFAULTS.productId,
      minItems: s.minItems || Bundle.DEFAULTS.minItems,
      maxItems: s.maxItems || Bundle.DEFAULTS.maxItems,
      discountPercent: s.discountPercent == null ? Bundle.DEFAULTS.discountPercent : s.discountPercent
    };
  };

  /* What the wrapped things come to before the saving. */
  Bundle.gross = function (lines) {
    var sum = 0;
    for (var i = 0; i < lines.length; i++) {
      sum += lines[i].unitPrice * (lines[i].qty || 1);
    }
    return Math.round(sum * 100) / 100;
  };

  /* The saving on one box. Rounded to the cent here, once, so a cart with two
     boxes cannot land a third of a cent away from what the Worker derives. */
  Bundle.saving = function (percent, lines) {
    if (!percent || !lines.length) return 0;
    return Math.round(Bundle.gross(lines) * percent) / 100;
  };

  /* Every box in a list of items. The gift-box item is the one whose productId
     is the box product; everything else sharing its boxId is what is in it. */
  Bundle.groups = function (items, config) {
    var byId = {};
    var order = [];
    items.forEach(function (item) {
      if (!item.boxId) return;
      if (!byId[item.boxId]) { byId[item.boxId] = { id: item.boxId, box: null, items: [] }; order.push(item.boxId); }
      if (item.productId === config.productId) byId[item.boxId].box = item;
      else byId[item.boxId].items.push(item);
    });
    return order.map(function (id) { return byId[id]; });
  };

  /* A box is only a box while it holds the right number of things and has its
     own ribbon and card line. Anything else is a group that fell apart, and it
     earns no saving. */
  Bundle.complete = function (group, config) {
    return !!group.box &&
      group.items.length >= config.minItems &&
      group.items.length <= config.maxItems;
  };

  Bundle.discount = function (items, settings) {
    var config = Bundle.config(settings);
    var total = 0;
    Bundle.groups(items, config).forEach(function (group) {
      if (!Bundle.complete(group, config)) return;
      total += Bundle.saving(config.discountPercent, group.items);
    });
    return Math.round(total * 100) / 100;
  };

})(window.Gifty = window.Gifty || {});
