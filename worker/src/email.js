/* Gifty Worker. The two emails.
 *
 * Resend allows 100 a day on the free plan, and an order sends two, so the real
 * ceiling is fifty orders a day. Both are sent, both are awaited, and a failure
 * is reported back rather than swallowed: an order that exists with no
 * confirmation is worse than an order that failed loudly and can be retried.
 *
 * The proof image in the buyer's email is the exact URL the buyer approved, the
 * same one stored on the order and shown in the admin. One image, three places.
 */

import { money } from './price.js';

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const WRAP = (inner) => `<!doctype html><html><body style="margin:0;padding:24px;background:#F7FAF9;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#14201F;line-height:1.6">
<div style="max-width:520px;margin:0 auto;background:#FFFFFF;border:1px solid #E3EAE8;border-radius:12px;padding:24px">
<p style="margin:0 0 20px;font-size:20px;font-weight:700;letter-spacing:-0.02em">Gift<span style="color:#0F766E">y</span></p>
${inner}
<p style="margin:24px 0 0;padding-top:16px;border-top:1px solid #E3EAE8;font-size:12px;color:#4A5654">Gifty. Custom gifts, made in Beirut.</p>
</div></body></html>`;

function itemRows(items) {
  return items.map((i) => `
<tr>
  <td style="padding:8px 0;vertical-align:top;width:88px">
    <img src="${esc(i.proofUrl)}" alt="" width="80" style="display:block;width:80px;border-radius:6px;border:1px solid #E3EAE8">
  </td>
  <td style="padding:8px 0 8px 12px;vertical-align:top">
    <strong>${esc(i.productName)}</strong>${i.qty > 1 ? ` x${i.qty}` : ''}<br>
    <span style="font-size:13px;color:#4A5654">${esc(i.summary || '')}</span>
  </td>
  <td style="padding:8px 0;vertical-align:top;text-align:right;white-space:nowrap">$${money(i.unitPrice * i.qty)}</td>
</tr>`).join('');
}

function totalsBlock(t) {
  return `
<table style="width:100%;border-collapse:collapse;font-size:14px;margin-top:8px">
  <tr><td style="padding:2px 0">Things</td><td style="padding:2px 0;text-align:right">$${money(t.subtotal)}</td></tr>
  ${t.discount ? `<tr><td style="padding:2px 0;color:#0F766E">Boxed together</td><td style="padding:2px 0;text-align:right;color:#0F766E">-$${money(t.discount)}</td></tr>` : ''}
  <tr><td style="padding:2px 0">Delivery</td><td style="padding:2px 0;text-align:right">$${money(t.delivery)}</td></tr>
  <tr><td style="padding:10px 0 0;border-top:1px solid #E3EAE8;font-weight:700">Total</td>
      <td style="padding:10px 0 0;border-top:1px solid #E3EAE8;text-align:right;font-weight:700">$${money(t.total)}</td></tr>
</table>`;
}

const PAY_LINE = {
  cod: 'Pay the driver in cash when it arrives. Nothing to do now.',
  whish: 'Send the total on Whish Money and reply with the reference number.',
  omt: 'Send the total through OMT and reply with the reference number.'
};

export function buyerEmail(order, trackUrl) {
  const inner = `
<p style="margin:0 0 8px;font-size:22px;font-weight:700">Your gift is on its way.</p>
<p style="margin:0 0 20px;color:#4A5654">Order <strong>${esc(order.orderNumber)}</strong>. Arriving <strong>${esc(order.delivery.promisedDate)}</strong>.</p>

<p style="margin:0 0 6px;font-weight:600">This is what goes to print</p>
<p style="margin:0 0 12px;font-size:13px;color:#4A5654">Exactly what you approved. If something looks wrong, reply to this email today and we will fix it before it is made.</p>

<table style="width:100%;border-collapse:collapse;font-size:14px">${itemRows(order.items)}</table>
${totalsBlock(order.totals)}

<p style="margin:20px 0 6px;font-weight:600">Paying</p>
<p style="margin:0 0 20px;color:#4A5654">${esc(PAY_LINE[order.payment.method] || '')}</p>

<p style="margin:0 0 6px;font-weight:600">Where it is going</p>
<p style="margin:0 0 20px;color:#4A5654">${esc(order.delivery.address)}<br>${esc(order.delivery.zoneName)}</p>

<p style="margin:0"><a href="${esc(trackUrl)}" style="display:inline-block;padding:12px 22px;background:#14B8A6;color:#14201F;text-decoration:none;border-radius:999px;font-weight:600">Follow your order</a></p>`;
  return { subject: `Order ${order.orderNumber}, arriving ${order.delivery.promisedDate}`, html: WRAP(inner) };
}

export function shopEmail(order, trackUrl) {
  const files = order.items.map((i, n) => `
<p style="margin:0 0 4px;font-size:13px">
  ${n + 1}. ${esc(i.productName)}${i.qty > 1 ? ` x${i.qty}` : ''} ,
  <a href="${esc(i.proofUrl)}">proof</a>
  ${i.printFileUrl ? ` , <a href="${esc(i.printFileUrl)}">print file</a>` : ''}
</p>`).join('');

  const inner = `
<p style="margin:0 0 8px;font-size:22px;font-weight:700">New order ${esc(order.orderNumber)}</p>
<p style="margin:0 0 20px;color:#4A5654">Promised for <strong>${esc(order.delivery.promisedDate)}</strong>.</p>

<table style="width:100%;border-collapse:collapse;font-size:14px">${itemRows(order.items)}</table>
${totalsBlock(order.totals)}

<p style="margin:20px 0 6px;font-weight:600">Files</p>
${files}

<p style="margin:20px 0 6px;font-weight:600">Buyer</p>
<p style="margin:0 0 20px;color:#4A5654">
  ${esc(order.buyer.name)}<br>
  ${esc(order.buyer.phone)}<br>
  ${esc(order.buyer.email || 'no email')}<br>
  ${esc(order.delivery.address)}<br>
  ${esc(order.delivery.zoneName)}
</p>

<p style="margin:0 0 6px;font-weight:600">Paying</p>
<p style="margin:0 0 20px;color:#4A5654">${esc(order.payment.method)}${order.payment.reference ? `, reference ${esc(order.payment.reference)}` : ''}</p>

${order.notes ? `<p style="margin:0 0 6px;font-weight:600">Note from the buyer</p><p style="margin:0 0 20px;color:#4A5654">${esc(order.notes)}</p>` : ''}

<p style="margin:0"><a href="${esc(trackUrl)}">${esc(trackUrl)}</a></p>`;
  return { subject: `New order ${order.orderNumber}, ${order.buyer.name}`, html: WRAP(inner) };
}

export async function send(env, to, mail) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ from: env.FROM_EMAIL, to: [to], subject: mail.subject, html: mail.html })
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`resend ${res.status} ${text.slice(0, 200)}`);
  }
  return res.json();
}
