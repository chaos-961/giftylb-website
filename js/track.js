/* Gifty. Following an order.
 *
 * One link, no login. The order number in the fragment is the whole key, which
 * is why the Worker hands back only what a stranger holding that link may see:
 * the status, the date, the pictures and the total. Never an address, a phone
 * number or an email.
 *
 * The fragment, not the query string, so the order number never lands in a
 * referrer header or a server log on the way to anyone else.
 */
(function (G) {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var STEPS = [
    { id: 'new', label: 'Order placed', blurb: 'We have it.' },
    { id: 'confirmed', label: 'Confirmed', blurb: 'Checked and queued.' },
    { id: 'production', label: 'Being made', blurb: 'On the press.' },
    { id: 'out', label: 'Out for delivery', blurb: 'With the driver.' },
    { id: 'delivered', label: 'Delivered', blurb: 'Enjoy it.' }
  ];

  var TICK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 13l5 5 9-11"/></svg>';

  function say(message) {
    $('error').hidden = false;
    $('error').textContent = message;
    $('result').hidden = true;
  }

  function paint(order) {
    $('error').hidden = true;
    $('result').hidden = false;

    var cancelled = order.status === 'cancelled';
    var index = STEPS.map(function (s) { return s.id; }).indexOf(order.status);
    var current = STEPS[index] || STEPS[0];

    $('status').textContent = cancelled ? 'Cancelled' : current.label;
    $('orderNumber').textContent = order.orderNumber;
    $('promised').textContent = cancelled
      ? 'This order was cancelled. If that is a surprise, message us and we will look into it.'
      : (order.status === 'delivered'
        ? 'Delivered to ' + order.zoneName + '.'
        : 'Arriving ' + order.promisedDate + ' in ' + order.zoneName + '.');

    /* The history carries the times the shop actually moved it, so a step that
       has happened says when, and one that has not says nothing rather than
       guessing. */
    var stamps = {};
    (order.statusHistory || []).forEach(function (h) { stamps[h.status] = h.at; });

    var box = $('steps');
    box.textContent = '';
    if (cancelled) { box.hidden = true; return; }
    box.hidden = false;

    STEPS.forEach(function (step, i) {
      var row = document.createElement('div');
      row.className = 'track__step';
      row.dataset.done = i <= index ? 'yes' : 'no';

      var dot = document.createElement('span');
      dot.className = 'track__dot';
      if (i <= index) dot.innerHTML = TICK;

      var text = document.createElement('div');
      var label = document.createElement('p');
      label.className = 'track__label';
      label.textContent = step.label;
      var when = document.createElement('p');
      when.className = 'track__when';
      when.textContent = stamps[step.id]
        ? new Date(stamps[step.id]).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
        : (i <= index ? '' : step.blurb);

      text.appendChild(label);
      text.appendChild(when);
      row.appendChild(dot);
      row.appendChild(text);
      box.appendChild(row);
    });

    var items = $('items');
    items.textContent = '';
    (order.items || []).forEach(function (i) {
      var row = document.createElement('div');
      row.className = 'track__item';

      var img = document.createElement('img');
      img.src = i.proofUrl;
      img.alt = 'Your ' + i.productName.toLowerCase();

      var text = document.createElement('div');
      var name = document.createElement('p');
      name.className = 'track__label';
      name.textContent = i.productName + (i.qty > 1 ? ' x' + i.qty : '');
      var sub = document.createElement('p');
      sub.className = 'track__when';
      sub.textContent = 'The image you approved';
      text.appendChild(name);
      text.appendChild(sub);

      row.appendChild(img);
      row.appendChild(text);
      items.appendChild(row);
    });
  }

  function look(number) {
    if (!window.GIFTY_API) {
      say('Order tracking is not switched on yet.');
      return;
    }
    $('error').hidden = true;
    fetch(window.GIFTY_API + '/api/order/' + encodeURIComponent(number))
      .then(function (res) {
        return res.json().then(function (body) { return { ok: res.ok, body: body }; });
      })
      .then(function (r) {
        if (!r.ok) { say(r.body.message || 'We cannot find that order number.'); return; }
        paint(r.body);
      })
      .catch(function () {
        say('We could not reach the order desk just now. Please try again in a moment.');
      });
  }

  function fromHash() {
    var n = decodeURIComponent(location.hash.replace(/^#/, '')).trim().toUpperCase();
    if (!n) return;
    $('number').value = n;
    look(n);
  }

  function boot() {
    $('find').addEventListener('submit', function (e) {
      e.preventDefault();
      var n = $('number').value.trim().toUpperCase();
      if (!n) return;
      location.hash = n;
      look(n);
    });
    window.addEventListener('hashchange', fromHash);
    fromHash();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})(window.Gifty = window.Gifty || {});
