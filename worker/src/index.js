/* Gifty. The one Worker.
 *
 *   POST /api/upload        Turnstile, then the buyer's photo on to the image
 *                           host with a key that never leaves this process
 *   POST /api/order         Turnstile, then re-derive every figure from the
 *                           catalogue, write the order, send two emails
 *   GET  /api/order/:number the tracking page's only source
 *
 * The browser sends what it believes the price is. This file does not believe
 * it. Every number on the order is derived here from the product documents and
 * the settings document, and a claim that disagrees is refused with the real
 * figures so the buyer can be shown what actually changed.
 */

import { Firestore, normalize } from './firestore.js';
import { computePrice, money, bundleConfig, bundleGroups, bundleComplete, bundleDiscount } from './price.js';
import { promise as deliveryPromise } from './promise.js';
import { buyerEmail, shopEmail, send } from './email.js';

/* ------------------------------------------------------------------- basics */

const json = (body, status, extra) => new Response(JSON.stringify(body), {
  status: status || 200,
  headers: { 'Content-Type': 'application/json', ...(extra || {}) }
});

function corsHeaders(request, env) {
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const origin = request.headers.get('Origin') || '';
  const ok = allowed.includes(origin);
  return {
    'Access-Control-Allow-Origin': ok ? origin : (allowed[0] || ''),
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  };
}

/* Every message a buyer can see blames us, never them, and never names a
   supplier. "Orders are not switched on yet", never "Firestore refused". */
const SORRY = 'Something went wrong on our side. Nothing has been charged. Please try again, or send us a message on WhatsApp and we will place it for you.';

async function turnstileOk(env, token, ip) {
  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET);
  form.append('response', token || '');
  if (ip) form.append('remoteip', ip);
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST', body: form
  });
  const body = await res.json().catch(() => ({}));
  return !!body.success;
}

/* ------------------------------------------------------------------- upload */

const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

async function handleUpload(request, env) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body.image !== 'string') {
    return json({ error: 'bad_request', message: SORRY }, 400);
  }
  if (!(await turnstileOk(env, body.token, request.headers.get('CF-Connecting-IP')))) {
    return json({ error: 'challenge_failed', message: 'That check did not pass. Please reload the page and try once more.' }, 403);
  }

  const base64 = body.image.replace(/^data:image\/[a-z+]+;base64,/, '');
  if (base64.length * 0.75 > MAX_UPLOAD_BYTES) {
    return json({ error: 'too_large', message: 'That photo is larger than we can take here. Send it on WhatsApp and we will place it for you.' }, 413);
  }

  const form = new FormData();
  form.append('key', env.IMGBB_API_KEY);
  form.append('image', base64);
  if (body.name) form.append('name', String(body.name).slice(0, 60));

  const res = await fetch('https://api.imgbb.com/1/upload', { method: 'POST', body: form });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || !out.data || !out.data.url) {
    return json({ error: 'upload_failed', message: SORRY }, 502);
  }
  return json({ url: out.data.url, thumb: (out.data.thumb && out.data.thumb.url) || out.data.url });
}

/* -------------------------------------------------------------------- order */

/* A design carries no data URLs by the time it reaches here: the photo was
   uploaded first and only its URL travels. Anything long enough to be an
   inlined image is refused rather than stored. */
function configOk(value, depth) {
  if (depth > 8) return false;
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return true;
  if (typeof value === 'string') return value.length <= 500;
  if (Array.isArray(value)) return value.length <= 40 && value.every((v) => configOk(v, depth + 1));
  if (typeof value === 'object') {
    const keys = Object.keys(value);
    return keys.length <= 40 && keys.every((k) => k.length <= 40 && configOk(value[k], depth + 1));
  }
  return false;
}

const str = (v, min, max) => typeof v === 'string' && v.trim().length >= min && v.trim().length <= max;

function orderNumber(prefix) {
  /* Five digits, not four. The tracking link needs no login by design, so the
     number is the only thing standing between a stranger and someone else's
     order page. Five keeps it sayable over the phone and makes a sweep of the
     whole space ten times more work. The page returns no address, phone or
     email either way. */
  const n = 10000 + Math.floor(Math.random() * 90000);
  return `${prefix}-${n}`;
}

function itemSummary(recipe, config) {
  const words = Object.values(config.zones || {})
    .map((z) => (z.text && z.text.value) || '')
    .filter((v) => v.trim());
  return words.length ? words.join(' / ') : 'No text';
}

async function handleOrder(request, env, ctx) {
  const body = await request.json().catch(() => null);
  if (!body) return json({ error: 'bad_request', message: SORRY }, 400);

  if (!(await turnstileOk(env, body.token, request.headers.get('CF-Connecting-IP')))) {
    return json({ error: 'challenge_failed', message: 'That check did not pass. Please reload the page and try once more.' }, 403);
  }

  const db = new Firestore(env);
  const settings = await db.read('settings/global');
  if (!settings) return json({ error: 'no_settings', message: SORRY }, 503);

  /* ---- shape */

  const buyer = body.buyer || {};
  if (!str(buyer.name, 2, 80)) {
    return json({ error: 'buyer_name', message: 'We need a name for the delivery.' }, 400);
  }
  if (!str(buyer.phone, 6, 24)) {
    return json({ error: 'buyer_phone', message: 'We need a phone number so the driver can call.' }, 400);
  }
  if (buyer.email && !str(buyer.email, 5, 120)) {
    return json({ error: 'buyer_email', message: 'That email does not look right.' }, 400);
  }

  const delivery = body.delivery || {};
  const zone = (settings.zones || []).find((z) => z.id === delivery.zone);
  if (!zone) return json({ error: 'zone', message: 'Please choose where it is going.' }, 400);
  if (!str(delivery.address, 5, 400)) {
    return json({ error: 'address', message: 'We need an address to deliver to.' }, 400);
  }

  const method = (body.payment && body.payment.method) || '';
  const payment = (settings.payments || []).find((p) => p.id === method);
  if (!payment) return json({ error: 'payment', message: 'Please choose how you want to pay.' }, 400);
  const reference = (body.payment && body.payment.reference) || null;
  if (payment.needsReference && !str(reference, 3, 60)) {
    return json({ error: 'reference', message: 'Add the transfer reference number so we can match your payment.' }, 400);
  }

  const incoming = Array.isArray(body.items) ? body.items : [];
  if (!incoming.length) return json({ error: 'empty', message: 'There is nothing in the cart.' }, 400);
  if (incoming.length > (settings.maxCartItems || 6)) {
    return json({ error: 'too_many', message: `An order can hold ${settings.maxCartItems || 6} things. Please split it into two.` }, 400);
  }

  /* ---- re-derive every figure */

  const items = [];
  let subtotal = 0;
  let slowest = 1;

  for (const raw of incoming) {
    const recipe = normalize(await db.read(`products/${String(raw.productId || '').slice(0, 40)}`) || {});
    if (!recipe.id) return json({ error: 'no_product', message: SORRY }, 400);

    const qty = Number(raw.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > 20) {
      return json({ error: 'qty', message: 'That quantity is not one we can make.' }, 400);
    }
    if (!configOk(raw.config, 0)) {
      return json({ error: 'config', message: SORRY }, 400);
    }
    if (!/^https:\/\//.test(String(raw.proofUrl || ''))) {
      return json({ error: 'proof', message: SORRY }, 400);
    }

    const priced = computePrice(recipe, raw.config || {});

    /* The tamper check. The browser told us what it charged; if that is not
       what the catalogue says today, nothing is written. */
    if (raw.unitPrice != null && Math.abs(Number(raw.unitPrice) - priced.total) > 0.005) {
      return json({
        error: 'price_changed',
        message: 'The price of one of these changed while you were designing. Here is the current one.',
        productId: recipe.id,
        was: Number(raw.unitPrice),
        now: priced.total
      }, 409);
    }

    subtotal += priced.total * qty;
    slowest = Math.max(slowest, recipe.leadTimeDays || 1);

    const boxId = raw.boxId == null ? null : String(raw.boxId);
    if (boxId !== null && !/^[a-z0-9]{4,24}$/i.test(boxId)) {
      return json({ error: 'box', message: SORRY }, 400);
    }

    items.push({
      productId: recipe.id,
      productName: recipe.name,
      boxId,
      config: raw.config || {},
      proofUrl: String(raw.proofUrl),
      printFileUrl: /^https:\/\//.test(String(raw.printFileUrl || '')) ? String(raw.printFileUrl) : '',
      unitPrice: priced.total,
      qty,
      leadTimeDays: recipe.leadTimeDays || 1,
      summary: itemSummary(recipe, raw.config || {})
    });
  }

  subtotal = Math.round(subtotal * 100) / 100;

  /* ---- the gift box

     A box is a group of lines sharing a boxId, one of which is the box product
     itself. The saving is derived here from the settings document, never taken
     from the browser, and a group that is not a real box earns nothing rather
     than being quietly repaired. */

  const boxCfg = bundleConfig(settings);
  for (const group of bundleGroups(items, boxCfg)) {
    if (!bundleComplete(group, boxCfg)) {
      return json({
        error: 'box_incomplete',
        message: `A gift box holds ${boxCfg.minItems} to ${boxCfg.maxItems} things. Please open the cart and put that one together again.`
      }, 400);
    }
  }
  const discount = bundleDiscount(items, settings);

  const totals = {
    subtotal,
    delivery: zone.fee,
    discount,
    total: Math.round((subtotal + zone.fee - discount) * 100) / 100
  };

  if (body.totals && Math.abs(Number(body.totals.total) - totals.total) > 0.005) {
    return json({
      error: 'total_changed',
      message: 'The total changed while you were checking out. Here is the current one.',
      was: Number(body.totals.total),
      now: totals.total
    }, 409);
  }

  const when = deliveryPromise(settings, slowest, zone.id);

  /* ---- write */

  const order = {
    orderNumber: '',
    status: 'new',
    buyer: {
      name: buyer.name.trim(),
      phone: buyer.phone.trim(),
      email: buyer.email ? String(buyer.email).trim() : null
    },
    delivery: {
      zone: zone.id,
      zoneName: zone.name,
      address: delivery.address.trim(),
      fee: zone.fee,
      promisedDate: when.label
    },
    items: items.map(({ summary, ...keep }) => keep),
    totals,
    payment: { method: payment.id, reference: reference ? String(reference).trim() : null },
    notes: str(body.notes, 1, 600) ? String(body.notes).trim() : null,
    statusHistory: [{ status: 'new', at: new Date().toISOString(), by: 'buyer' }]
  };

  let created = null;
  for (let attempt = 0; attempt < 6 && !created; attempt++) {
    order.orderNumber = orderNumber(settings.orderPrefix || 'GFT');
    try {
      await db.createOrder(order.orderNumber, order);
      created = order.orderNumber;
    } catch (err) {
      /* A collision on the number is the only thing worth another go. A refusal
         is a refusal and retrying it five more times helps nobody. */
      const clash = err.status === 409 || /ALREADY_EXISTS|already exists/i.test(err.message);
      if (!clash) {
        return json({ error: 'write_refused', message: SORRY, detail: env.DEBUG ? err.message : undefined }, 502);
      }
    }
  }
  if (!created) return json({ error: 'no_number', message: SORRY }, 503);

  /* ---- tell everyone */

  const trackUrl = `${env.SITE_ORIGIN}/track.html#${created}`;
  const withSummaries = { ...order, items };
  const errors = [];

  if (order.buyer.email) {
    try { await send(env, order.buyer.email, buyerEmail(withSummaries, trackUrl)); }
    catch (e) { errors.push('buyer'); }
  }
  if (settings.shopEmail) {
    try { await send(env, settings.shopEmail, shopEmail(withSummaries, trackUrl)); }
    catch (e) { errors.push('shop'); }
  } else {
    /* No shop address configured means nobody in the workshop learns an order
       exists. That is a misconfiguration, so it is reported, never swallowed. */
    errors.push('shop_email_not_set');
  }

  return json({
    orderNumber: created,
    promisedDate: when.label,
    total: totals.total,
    totalLabel: '$' + money(totals.total),
    trackUrl,
    emailsFailed: errors.length ? errors : undefined
  });
}

/* ----------------------------------------------------------------- tracking */

async function handleLookup(request, env, number) {
  if (!/^[A-Z]{2,5}-[0-9]{4,6}$/.test(number)) {
    return json({ error: 'bad_number', message: 'That order number does not look right.' }, 400);
  }
  const db = new Firestore(env);
  const order = await db.authedRead(`orders/${number}`).catch(() => null);
  if (!order) {
    return json({ error: 'not_found', message: 'We cannot find that order number. Check the email we sent you, or message us on WhatsApp.' }, 404);
  }

  /* Deliberately narrow. The link needs no login, so it must never hand over
     an address, a phone number or an email. */
  return json({
    orderNumber: order.orderNumber,
    status: order.status,
    promisedDate: order.delivery.promisedDate,
    zoneName: order.delivery.zoneName,
    statusHistory: order.statusHistory || [],
    items: (order.items || []).map((i) => ({
      productName: i.productName, proofUrl: i.proofUrl, qty: i.qty
    })),
    total: order.totals.total
  });
}

/* ------------------------------------------------------------------- router */

export default {
  async fetch(request, env, ctx) {
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const url = new URL(request.url);
    let res;

    try {
      if (request.method === 'POST' && url.pathname === '/api/upload') {
        res = await handleUpload(request, env);
      } else if (request.method === 'POST' && url.pathname === '/api/order') {
        res = await handleOrder(request, env, ctx);
      } else if (request.method === 'GET' && url.pathname.startsWith('/api/order/')) {
        res = await handleLookup(request, env, decodeURIComponent(url.pathname.slice('/api/order/'.length)));
      } else {
        res = json({ error: 'not_found' }, 404);
      }
    } catch (err) {
      res = json({ error: 'server', message: SORRY, detail: env.DEBUG ? String(err && err.message) : undefined }, 500);
    }

    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
    return out;
  }
};
