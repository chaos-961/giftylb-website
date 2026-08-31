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
