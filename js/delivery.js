/* Gifty. The delivery promise.
 *
 * Never "3 to 5 business days". A date, worked out from how long the thing
 * takes to make and how far it has to go, in the shop's own timezone rather
 * than the buyer's. Every number comes from data/settings.json, which is the
 * settings/global document the admin edits in P4.
 */
(function (G) {
  'use strict';

  var D = G.Delivery = {};

  var DAY_MS = 86400000;
  var settings = null;
  var loading = null;

  D.load = function () {
    if (settings) return Promise.resolve(settings);
    if (loading) return loading;
    loading = G.Data.doc('settings/global').then(function (s) {
      if (!s) throw new Error('there is no settings document');
      settings = s;
      return s;
    });
    return loading;
  };

  D.settings = function () { return settings; };

  D.zone = function (id) {
    if (!settings) return null;
    var want = id || settings.defaultZone;
    return settings.zones.filter(function (z) { return z.id === want; })[0] || settings.zones[0];
  };

  /* -------------------------------------------------------- shop local time
     A buyer in Sydney ordering at their 9am is ordering at Beirut's midnight,
     and the cutoff belongs to Beirut. So the calendar we count on is always the
     shop's, taken from Intl rather than from the device clock's offset. */

  function shopParts(now) {
    var fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: settings.timeZone, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
    });
    var got = {};
    fmt.formatToParts(now || new Date()).forEach(function (p) { got[p.type] = p.value; });
    return {
      y: +got.year, m: +got.month, d: +got.day,
      hour: +got.hour % 24, minute: +got.minute
    };
  }

  /* Calendar arithmetic runs on a UTC noon anchor. Noon is far enough from both
     edges that no daylight saving shift can push a date onto the wrong day. */
  function anchor(p) { return new Date(Date.UTC(p.y, p.m - 1, p.d, 12)); }

  function iso(dt) {
    return dt.getUTCFullYear() + '-' +
      String(dt.getUTCMonth() + 1).padStart(2, '0') + '-' +
      String(dt.getUTCDate()).padStart(2, '0');
  }

  function isWorking(dt) {
    if (settings.workingDays.indexOf(dt.getUTCDay()) < 0) return false;
    return (settings.blackoutDates || []).indexOf(iso(dt)) < 0;
  }

  function nextWorking(dt) {
    var d = new Date(dt.getTime());
    var guard = 0;
    while (!isWorking(d) && guard++ < 40) d = new Date(d.getTime() + DAY_MS);
    return d;
  }

  function advance(dt, days) {
    var d = new Date(dt.getTime());
    var left = days, guard = 0;
    while (left > 0 && guard++ < 200) {
      d = new Date(d.getTime() + DAY_MS);
      if (isWorking(d)) left--;
    }
    return d;
  }

  /* ------------------------------------------------------------- the promise

     leadTimeDays is production. transitDays is the van. Both are counted in
     working days, and the first production day is the day it starts, which is
     why the sum takes one off. Past the cutoff, production starts tomorrow. */

  D.promise = function (leadTimeDays, zoneId, now) {
    if (!settings) return null;
    var z = D.zone(zoneId);
    var p = shopParts(now);
    var today = anchor(p);

    var live = isWorking(today) && p.hour < settings.cutoffHour;
    var start = live ? today : nextWorking(new Date(today.getTime() + DAY_MS));

    var lead = Math.max(1, leadTimeDays || 1);
    var date = advance(start, lead - 1 + z.transitDays);

    return {
      date: date,
      label: D.label(date),
      zone: z,
      cutoffLeftMs: live
        ? ((settings.cutoffHour - p.hour) * 60 - p.minute) * 60000
        : null
    };
  };

  D.label = function (dt) {
    var parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short'
    }).formatToParts(dt);
    var get = function (t) {
      var p = parts.filter(function (x) { return x.type === t; })[0];
      return p ? p.value : '';
    };
    /* Built from the parts rather than taken as a string: the same options
       render as "Fri 4 Sept" in one engine and "Fri, 4 Sept" in another, and
       the card and the confirmation email must not disagree. */
    return get('weekday') + ' ' + get('day') + ' ' + get('month');
  };

  /* "4 h 20 m". Minutes only under the hour, so it never reads like a timer. */
  D.countdown = function (ms) {
    var mins = Math.max(0, Math.floor(ms / 60000));
    var h = Math.floor(mins / 60), m = mins % 60;
    return h ? h + ' h ' + m + ' m' : m + ' m';
  };

  /* One control for the zone, everywhere it is asked. A native select is one
     44px line instead of a row of chips that wraps on a phone, and it needs no
     keyboard handling of its own. */

  D.zoneSelect = function (id, current, onPick) {
    var sel = document.createElement('select');
    sel.className = 'zone-select';
    sel.id = id;
    settings.zones.forEach(function (z) {
      var o = document.createElement('option');
      o.value = z.id;
      o.textContent = z.name;
      if (z.id === (current || settings.defaultZone)) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener('change', function () { onPick(sel.value); });
    return sel;
  };

  /* One sentence, the way it is said on a card and in the cart. */
  D.sentence = function (promise) {
    if (!promise) return '';
    return promise.cutoffLeftMs != null && promise.cutoffLeftMs > 0
      ? 'Order in the next ' + D.countdown(promise.cutoffLeftMs) + ', get it ' + promise.label + '.'
      : 'Order today, get it ' + promise.label + '.';
  };

})(window.Gifty = window.Gifty || {});
