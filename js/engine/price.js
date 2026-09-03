/* Gifty engine. Live price.
 *
 * Pure function of the recipe and the design. No network, no rounding surprises,
 * and no "calculate" button ever. P4 re-derives the same number server side from
 * the same recipe, so a client that lies about the total is rejected.
 *
 * The `when` vocabulary is deliberately tiny. A new product prices itself by
 * combining these clauses, not by adding new ones.
 */
(function (G) {
  'use strict';

  var Price = G.Price = {};

  function zoneOf(state, id) { return (state.zones && state.zones[id]) || {}; }

  function textLineCount(state, recipe, zoneId) {
    var z = zoneOf(state, zoneId);
    if (!z.text || !z.text.value) return 0;
    var rule = (recipe.textRules || []).filter(function (r) { return r.zoneId === zoneId; })[0] || {};
    var value = G.Design.applyTextRules(rule, z.text.value).trim();
    if (!value) return 0;
    /* One priced line per line the buyer actually gets, capped by the rule. */
    var lines = value.split('\n').filter(function (l) { return l.trim(); }).length || 1;
    return Math.min(lines, rule.maxLines || 1);
  }

  var CLAUSES = {
    zoneHasPhoto: function (state, recipe, arg) {
      var z = zoneOf(state, arg);
      return (z.photo && z.photo.image) ? 1 : 0;
    },
    perTextLine: function (state, recipe, arg) {
      return textLineCount(state, recipe, arg);
    },
    zoneHasFill: function (state, recipe, arg) {
      var z = zoneOf(state, arg);
      return z.fill ? 1 : 0;
    },
    partNotDefault: function (state, recipe, arg) {
      var part = (recipe.colorParts || []).filter(function (p) { return p.id === arg; })[0];
      if (!part) return 0;
      var chosen = (state.colors && state.colors[arg]) || part.default;
      return chosen.toUpperCase() === part.default.toUpperCase() ? 0 : 1;
    }
  };

  Price.compute = function (recipe, state) {
    var lines = [{ label: recipe.name, amount: recipe.basePrice }];

    (recipe.pricing || []).forEach(function (rule) {
      var key = Object.keys(rule.when)[0];
      var fn = CLAUSES[key];
      if (!fn) return;
      var units = fn(state, recipe, rule.when[key]);
      if (!units) return;
      lines.push({
        label: units > 1 ? rule.label + ' x' + units : rule.label,
        amount: Math.round(rule.amount * units * 100) / 100
      });
    });

    var total = lines.reduce(function (sum, l) { return sum + l.amount; }, 0);
    return { lines: lines, total: Math.round(total * 100) / 100, currency: recipe.currency || 'USD' };
  };

  Price.format = function (amount, currency) {
    var n = Math.round(amount * 100) / 100;
    var s = n % 1 === 0 ? String(n) : n.toFixed(2);
    return (currency === 'USD' ? '$' : '') + s;
  };

})(window.Gifty = window.Gifty || {});
