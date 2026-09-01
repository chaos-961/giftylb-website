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
    /* Read off the order document itself now, not off a response some server
       reshaped on the way out. The date and the zone live under delivery, and
       reading them from the top level is how this page said "Arriving undefined
       in undefined" the first time it was pointed at the real document. */
    var going = order.delivery || {};
    $('promised').textContent = cancelled
      ? 'This order was cancelled. If that is a surprise, message us and we will look into it.'
      : (order.status === 'delivered'
        ? 'Delivered to ' + going.zoneName + '.'
        : 'Arriving ' + going.promisedDate + ' in ' + going.zoneName + '.');

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
    (order.items || []).forEach(function (i, n) {
      var row = document.createElement('div');
      row.className = 'track__item';

      var img = document.createElement('img');
      /* The proof is stored beside the order in chunks, so it arrives after the
         rest of the page. Left empty until then rather than broken. */
      img.alt = 'Your ' + i.productName.toLowerCase();
      img.dataset.asset = n + '-proof';

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
    $('error').hidden = true;

    /* Read by document id, never by listing. The rules allow a get on one order
       and refuse a list, which is what makes a tracking link work with no login
       without letting anybody walk the whole collection. */
    G.Data.orderByNumber(number)
      .then(function (order) {
        if (!order) { say('We cannot find that order number.'); return; }
        paint(order);
        return fillProofs(number);
      })
      .catch(function () {
        say('We could not look that up just now. Please try again in a moment.');
      });
  }

  /* The pictures follow the order, because they are stored in pieces beside it.
     A missing one leaves the row without an image rather than with a broken
     one: half an order page still tells the buyer where their order is. */
  function fillProofs(number) {
    return G.Order.assets(number).then(function (assets) {
      document.querySelectorAll('#items img[data-asset]').forEach(function (img) {
        var src = assets[img.dataset.asset];
        if (src) img.src = src;
      });
    }).catch(function () {});
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
