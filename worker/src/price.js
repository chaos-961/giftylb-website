/* Gifty Worker. The price, re-derived.
 *
 * This is deliberately a second implementation of js/engine/price.js rather
 * than a shared one: the browser file is a script tag IIFE and the Worker is a
 * module, and there is no build step to bridge them. The `when` vocabulary is
 * three clauses and has not grown since P2, so the duplication is small. What
 * keeps it honest is tools/test-price-parity.mjs, which runs both files over
 * every template and every product and fails if a single total disagrees.
 *
 * Nothing here trusts the request. Every number comes from the product document
 * read out of Firestore a moment earlier.
 */

function zoneOf(config, id) {
  return (config.zones && config.zones[id]) || {};
}

function applyTextRules(rule, text) {
  const t = String(text == null ? '' : text);
  return rule && rule.maxChars ? t.slice(0, rule.maxChars) : t;
}

function textLineCount(config, recipe, zoneId) {
  const z = zoneOf(config, zoneId);
  if (!z.text || !z.text.value) return 0;
  const rule = (recipe.textRules || []).find((r) => r.zoneId === zoneId) || {};
  const value = applyTextRules(rule, z.text.value).trim();
  if (!value) return 0;
  const lines = value.split('\n').filter((l) => l.trim()).length || 1;
  return Math.min(lines, rule.maxLines || 1);
}

const CLAUSES = {
  zoneHasPhoto(config, recipe, arg) {
    const z = zoneOf(config, arg);
    return z.photo ? 1 : 0;
  },
  perTextLine(config, recipe, arg) {
    return textLineCount(config, recipe, arg);
  },
  partNotDefault(config, recipe, arg) {
    const part = (recipe.colorParts || []).find((p) => p.id === arg);
    if (!part) return 0;
    const chosen = (config.colors && config.colors[arg]) || part.default;
    return String(chosen).toUpperCase() === String(part.default).toUpperCase() ? 0 : 1;
  }
};

export function computePrice(recipe, config) {
  const lines = [{ label: recipe.name, amount: recipe.basePrice }];

  for (const rule of recipe.pricing || []) {
    const clause = Object.keys(rule.when)[0];
    const fn = CLAUSES[clause];
    if (!fn) continue;
    const units = fn(config, recipe, rule.when[clause]);
    if (!units) continue;
    lines.push({
      label: units > 1 ? `${rule.label} x${units}` : rule.label,
      amount: Math.round(rule.amount * units * 100) / 100
    });
  }

  const total = lines.reduce((sum, l) => sum + l.amount, 0);
  return { lines, total: Math.round(total * 100) / 100 };
}

/* The ceiling one of these can cost, which is what the security rule reads as
   its bound. Recomputed on every catalogue write so it can never drift from
   the pricing rules it summarises. */
export function maxExtras(recipe) {
  let total = 0;
  for (const rule of recipe.pricing || []) {
    const clause = Object.keys(rule.when)[0];
    const arg = rule.when[clause];
    let units = 1;
    if (clause === 'perTextLine') {
      const text = (recipe.textRules || []).find((r) => r.zoneId === arg);
      units = (text && text.maxLines) || 1;
    }
    total += rule.amount * units;
  }
  return Math.round(total * 100) / 100;
}

export function money(n) {
  const v = Math.round(n * 100) / 100;
  return v % 1 === 0 ? String(v) : v.toFixed(2);
}

/* ---------------------------------------------------------------- the box

   The gift box is a group, not a container: two to four items the buyer
   designed, plus one gift-box line for the ribbon and the card, all sharing a
   boxId. Every line still prices against its own product document, which is
   what keeps the order rule able to bound it.

   This is the module form of js/bundle.js. The two are held equal by
   tools/test-parity.mjs. Never edit one without the other.
*/

export const BUNDLE_DEFAULTS = { productId: 'gift-box', minItems: 2, maxItems: 4, discountPercent: 10 };

export function bundleConfig(settings) {
  const s = (settings && settings.giftBox) || {};
  return {
    productId: s.productId || BUNDLE_DEFAULTS.productId,
    minItems: s.minItems || BUNDLE_DEFAULTS.minItems,
    maxItems: s.maxItems || BUNDLE_DEFAULTS.maxItems,
    discountPercent: s.discountPercent == null ? BUNDLE_DEFAULTS.discountPercent : s.discountPercent
  };
}

export function bundleGross(lines) {
  let sum = 0;
  for (const l of lines) sum += l.unitPrice * (l.qty || 1);
  return Math.round(sum * 100) / 100;
}

export function bundleSaving(percent, lines) {
  if (!percent || !lines.length) return 0;
  return Math.round(bundleGross(lines) * percent) / 100;
}

export function bundleGroups(items, config) {
  const byId = {};
  const order = [];
  for (const item of items) {
    if (!item.boxId) continue;
    if (!byId[item.boxId]) { byId[item.boxId] = { id: item.boxId, box: null, items: [] }; order.push(item.boxId); }
    if (item.productId === config.productId) byId[item.boxId].box = item;
    else byId[item.boxId].items.push(item);
  }
  return order.map((id) => byId[id]);
}

export function bundleComplete(group, config) {
  return !!group.box &&
    group.items.length >= config.minItems &&
    group.items.length <= config.maxItems;
}

export function bundleDiscount(items, settings) {
  const config = bundleConfig(settings);
  let total = 0;
  for (const group of bundleGroups(items, config)) {
    if (!bundleComplete(group, config)) continue;
    total += bundleSaving(config.discountPercent, group.items);
  }
  return Math.round(total * 100) / 100;
}
