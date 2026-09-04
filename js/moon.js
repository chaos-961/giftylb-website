/* Gifty. The birth moon page.
 *
 * Enter a date, see that night's moon, scrub through every full moon since,
 * then carry the date into the customizer. The sky is drawn by
 * js/engine/moon.js from js/lunar.js and nothing here knows how; this file
 * owns the form, the facts and the transport.
 */
(function (G) {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var L = G.Lunar, M = G.Moon;
  if (!L || !M) return;

  var canvas = $('moonCanvas');
  var live = null;
  var birth = null;          /* the chosen instant, or null while showing tonight */
  var fulls = [];            /* JD of each full moon since, filled as they are asked for */
  var fullCount = 0;
  var playing = null;

  function reduced() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  var longDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  var shortTime = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });

  function fit() {
    if (!live) return;
    var rect = canvas.getBoundingClientRect();
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    live.resize(Math.max(2, Math.round(rect.width * dpr)), Math.max(2, Math.round(rect.height * dpr)));
  }

  /* One instant on the sky and in the facts. */
  function show(date, label) {
    var state = M.stateAt(date);
    var d = M.describe(state);
    if (live) live.set(date);
    $('phaseName').textContent = d.phase;
    $('phaseWhen').textContent = label || (longDate.format(date) + ', ' + shortTime.format(date));
    $('factIllum').textContent = d.illumination + '%';
    $('factAge').textContent = d.ageDays + ' days';
    $('factDistance').textContent = Math.round(d.distanceKm / 1000) + ',000 km, ' + d.distanceLabel;
    $('factZodiac').textContent = d.zodiac;
    canvas.setAttribute('aria-label', 'The moon on ' + longDate.format(date) + ': ' + d.phase.toLowerCase() + ', ' + d.illumination + ' percent lit');
  }

  /* The nth full moon after the birth instant, found from the one before it
     so the search never skips a month. */
  function fullAt(n) {
    if (fulls[n]) return fulls[n];
    var jd = n === 0 ? L.nextEvent(L.dateToJD(birth), 180) : L.nextEvent(fullAt(n - 1) + 20, 180);
    fulls[n] = jd;
    return jd;
  }

  function showBirth() {
    show(birth, longDate.format(birth) + ', ' + shortTime.format(birth) + '. The night you were born.');
    $('scrub').value = 0;
    $('journeySay').textContent = fullCount + ' full moons have risen since.';
  }

  function scrubTo(n) {
    n = Math.max(0, Math.min(fullCount, +n || 0));
    if (n === 0) { showBirth(); return; }
    var date = L.jdToDate(fullAt(n - 1));
    show(date, longDate.format(date) + '. Full moon ' + n + ' of ' + fullCount + '.');
    $('journeySay').textContent = 'Full moon ' + n + ' of ' + fullCount + ', ' + longDate.format(date) + '.';
  }

  function stop() {
    if (playing) { clearInterval(playing); playing = null; }
    $('playBtn').textContent = 'Play';
  }

  function play() {
    if (playing) { stop(); return; }
    var scrub = $('scrub');
    if (+scrub.value >= fullCount) scrub.value = 0;
    $('playBtn').textContent = 'Pause';
    /* Fast enough that a lifetime passes in under a minute, slow enough that
       the libration nod reads as a nod. */
    var every = reduced() ? 400 : Math.max(60, Math.min(260, 24000 / Math.max(1, fullCount)));
    playing = setInterval(function () {
      var n = +scrub.value + 1;
      if (n > fullCount) { stop(); return; }
      scrub.value = n;
      scrubTo(n);
    }, every);
  }

  function chosen(e) {
    e.preventDefault();
    var d = $('birthDate').value, t = $('birthTime').value || '12:00';
    var err = $('moonError');
    err.textContent = '';
    if (!d) { err.textContent = 'Put in a date first.'; return; }
    var parts = d.split('-'), tp = t.split(':');
    var date = new Date(+parts[0], +parts[1] - 1, +parts[2], +tp[0], +tp[1]);
    if (isNaN(date.getTime())) { err.textContent = 'That date did not read. Try again.'; return; }
    if (date.getTime() > Date.now()) { err.textContent = 'That night has not happened yet.'; return; }

    stop();
    birth = date;
    fulls = [];
    var now = new Date();
    fullCount = L.countEventsBetween(L.dateToJD(birth), L.dateToJD(now), 180);
    var next = L.jdToDate(L.nextEvent(L.dateToJD(now), 180));
    $('factFulls').textContent = String(fullCount);
    $('factNext').textContent = longDate.format(next);

    var journey = $('journey');
    journey.hidden = fullCount < 1;
    $('scrub').max = fullCount;
    showBirth();

    var link = $('printLink');
    link.href = 'customize.html?p=moon-print&date=' + encodeURIComponent(d) + '&time=' + encodeURIComponent(t);
    document.title = 'The moon on ' + longDate.format(birth) + '. Gifty';
    journey.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'nearest' });
  }

  function price() {
    if (!G.Recipe || !G.Recipe.load) return;
    G.Recipe.load('moon-print').then(function (r) {
      $('printFrom').textContent = 'from $' + r.basePrice;
    }).catch(function () {});
  }

  function init() {
    live = M.live(canvas);
    if (!live.supported) $('moonNoGl').hidden = false;
    fit();
    window.addEventListener('resize', fit);

    /* Tonight, until a date is chosen. */
    var now = new Date();
    show(now, 'Tonight, ' + longDate.format(now));
    var next = L.jdToDate(L.nextEvent(L.dateToJD(now), 180));
    $('factNext').textContent = longDate.format(next);
    $('factFulls').textContent = 'Pick a date';

    var today = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    $('birthDate').max = today;

    $('moonForm').addEventListener('submit', chosen);
    $('scrub').addEventListener('input', function () { stop(); scrubTo(this.value); });
    $('playBtn').addEventListener('click', play);
    $('birthBtn').addEventListener('click', function () { stop(); showBirth(); });
    price();

    /* A date in the address opens straight onto that night. */
    var q = new URLSearchParams(location.search);
    if (q.get('date')) {
      $('birthDate').value = q.get('date');
      if (q.get('time')) $('birthTime').value = q.get('time');
      chosen({ preventDefault: function () {} });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})(window.Gifty = window.Gifty || {});
