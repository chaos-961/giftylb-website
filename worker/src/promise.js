/* Gifty Worker. The delivery date, computed server side.
 *
 * A mirror of js/delivery.js, for the same reason price.js is a mirror: a
 * script tag IIFE and a module with no build step between them. The date the
 * buyer was promised is written onto the order and mailed to them, so it is
 * never taken from the request. tools/test-price-parity.mjs runs both files
 * over the same calendar and fails on the first disagreement.
 */

const DAY_MS = 86400000;

function shopParts(settings, now) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: settings.timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
  });
  const got = {};
  for (const p of fmt.formatToParts(now || new Date())) got[p.type] = p.value;
  return { y: +got.year, m: +got.month, d: +got.day, hour: +got.hour % 24, minute: +got.minute };
}

const anchor = (p) => new Date(Date.UTC(p.y, p.m - 1, p.d, 12));

const iso = (dt) => dt.getUTCFullYear() + '-' +
  String(dt.getUTCMonth() + 1).padStart(2, '0') + '-' +
  String(dt.getUTCDate()).padStart(2, '0');

function isWorking(settings, dt) {
  if (!settings.workingDays.includes(dt.getUTCDay())) return false;
  return !(settings.blackoutDates || []).includes(iso(dt));
}

function nextWorking(settings, dt) {
  let d = new Date(dt.getTime());
  let guard = 0;
  while (!isWorking(settings, d) && guard++ < 40) d = new Date(d.getTime() + DAY_MS);
  return d;
}

function advance(settings, dt, days) {
  let d = new Date(dt.getTime());
  let left = days, guard = 0;
  while (left > 0 && guard++ < 200) {
    d = new Date(d.getTime() + DAY_MS);
    if (isWorking(settings, d)) left--;
  }
  return d;
}

/* Built from the parts rather than taken as a string: the same options render
   as "Fri 4 Sept" in one engine and "Fri, 4 Sept" in another, and the card and
   the confirmation email must not disagree. */
export function label(dt) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short'
  }).formatToParts(dt);
  const get = (t) => (parts.find((x) => x.type === t) || {}).value || '';
  return `${get('weekday')} ${get('day')} ${get('month')}`;
}

export function promise(settings, leadTimeDays, zoneId, now) {
  const z = (settings.zones || []).find((x) => x.id === zoneId) || settings.zones[0];
  const p = shopParts(settings, now);
  const today = anchor(p);

  const live = isWorking(settings, today) && p.hour < settings.cutoffHour;
  const start = live ? today : nextWorking(settings, new Date(today.getTime() + DAY_MS));

  const lead = Math.max(1, leadTimeDays || 1);
  const date = advance(settings, start, lead - 1 + z.transitDays);

  return { date, label: label(date), zone: z };
}
