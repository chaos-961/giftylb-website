/* Gifty. The chrome that moves: the phone menu, the way back up, the reveals.
 *
 * Three small things every page needs and none of them owns.
 *
 *   menu     below the tablet width the header keeps Shop and the cart, and
 *            everything else lives in a sheet behind one button. Before this
 *            file a phone could not reach "How it works" or "Delivery" from any
 *            page but the homepage's own footer.
 *   top      a button back to the top of a long page. It appears after a screen
 *            and a half of scroll, on the shop grid and the cart mostly, and it
 *            is never on screen at the top where it would be a lie.
 *   reveal   the IntersectionObserver half of the scroll reveal, for browsers
 *            without view() timelines. It used to live in js/main.js, which only
 *            the homepage loads, so a .reveal on any other page would have been
 *            hidden by the head script and never shown. Now the observer is on
 *            every page and the homepage's main.js defers to it.
 *
 * All of it is additive. A page where this file did not load has a header with
 * a menu button that does nothing, a sheet that stays hidden, and content that
 * is visible, because nothing is hidden unless the code that shows it is here.
 */
(function (G) {
  'use strict';

  var doc = document.documentElement;

  /* ------------------------------------------------------------------ menu */

  function menu() {
    var btn = document.querySelector('.nav-toggle');
    var sheet = document.getElementById('navSheet');
    if (!btn || !sheet) return;

    function open() {
      sheet.hidden = false;
      /* Two frames, so the hidden attribute is really gone before the class
         that slides it in lands, or the transition never runs. */
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { sheet.classList.add('is-open'); });
      });
      btn.setAttribute('aria-expanded', 'true');
      doc.setAttribute('data-menu', '');
      var first = sheet.querySelector('a');
      if (first) first.focus({ preventScroll: true });
    }

    function close(back) {
      sheet.classList.remove('is-open');
      btn.setAttribute('aria-expanded', 'false');
      doc.removeAttribute('data-menu');
      /* Hidden again once the slide has finished, so it is not in the tab
         order and not on screen. The timeout is the sheet's own transition,
         and a browser under reduced motion has a zero length one. */
      setTimeout(function () { if (!sheet.classList.contains('is-open')) sheet.hidden = true; }, 260);
      if (back) btn.focus();
    }

    btn.addEventListener('click', function () {
      if (btn.getAttribute('aria-expanded') === 'true') close(true); else open();
    });
    sheet.addEventListener('click', function (e) {
      /* A tap on the dark ground or on a link closes it. A link still goes
         where it goes; the sheet is simply not in the way when it lands. */
      if (e.target === sheet || (e.target.closest && e.target.closest('a'))) close(false);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !sheet.hidden) close(true);
    });
    /* The sheet is a phone thing. Turning the phone or widening the window
       past the breakpoint puts the links back in the bar, so it goes. */
    var wide = window.matchMedia('(min-width: 46rem)');
    var onWide = function () { if (wide.matches && !sheet.hidden) close(false); };
    if (wide.addEventListener) wide.addEventListener('change', onWide);
    else wide.addListener(onWide);
  }

  /* ------------------------------------------------------------------- top */

  function top() {
    if (document.querySelector('.to-top')) return;
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'to-top';
    b.setAttribute('aria-label', 'Back to the top');
    b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5"/><path d="M6 11l6-6 6 6"/></svg>';
    document.body.appendChild(b);

    var shown = false, ticking = false;
    function check() {
      ticking = false;
      var want = window.scrollY > window.innerHeight * 1.5;
      if (want === shown) return;
      shown = want;
      b.classList.toggle('is-shown', shown);
    }
    window.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(check);
    }, { passive: true });

    b.addEventListener('click', function () {
      var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
      /* Focus goes to the top of the page too, so a keyboard user is not left
         with their focus on a button that has just slid away. */
      var main = document.getElementById('main');
      if (main) { main.setAttribute('tabindex', '-1'); main.focus({ preventScroll: true }); }
    });
    check();
  }

  /* ---------------------------------------------------------------- reveal

     Only when the head decided the observer path runs: .reveal-js is set there,
     synchronously, and only when view() timelines are missing and an
     IntersectionObserver is not. Nothing is hidden unless that class is on the
     root, so a browser that gets neither path gets a finished page. */

  var io = null;

  function reveal() {
    if (!doc.classList.contains('reveal-js') || !('IntersectionObserver' in window)) return;
    io = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        if (!entries[i].isIntersecting) continue;
        entries[i].target.classList.add('is-in');
        io.unobserve(entries[i].target);
      }
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.05 });
    G.reveal(document);
  }

  /* Lists built at runtime ask for a second pass once they have painted. On
     the scroll driven path there is nothing to do: a view() timeline attaches
     itself the moment the element exists. */
  G.reveal = function (root) {
    if (!io) return;
    var late = (root || document).querySelectorAll('.reveal:not(.is-in)');
    for (var k = 0; k < late.length; k++) io.observe(late[k]);
  };

  /* -------------------------------------------------------------------- go */

  function start() {
    menu();
    top();
    reveal();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

})(window.Gifty = window.Gifty || {});
