/* Gifty. Site wide behaviour.
   Deliberately small. The storefront JS budget is 120KB gzipped for the whole
   route, and the customizer in P2 is the thing that gets to spend it. */

(function () {
  'use strict';

  /* Footer year. */
  var year = document.getElementById('year');
  if (year) year.textContent = String(new Date().getFullYear());

  /* ------------------------------------------------------------- analytics

     Loaded last, after everything the page needs, and only when a token has
     actually been set. It is cookieless and stores nothing on the device, so
     there is no consent banner here. A site with no token makes no third party
     request at all rather than one that fails. */

  (function () {
    var token = window.GIFTY_CONFIG && window.GIFTY_CONFIG.analyticsToken;
    if (!token) return;
    function beacon() {
      var s = document.createElement('script');
      s.defer = true;
      s.src = 'https://static.cloudflareinsights.com/beacon.min.js';
      s.setAttribute('data-cf-beacon', JSON.stringify({ token: token }));
      document.head.appendChild(s);
    }
    if (document.readyState === 'complete') beacon();
    else window.addEventListener('load', beacon);
  })();

  /* Scroll reveal fallback.
     The preferred path is the CSS scroll driven animation in base.css, which
     runs off the main thread and holds 60fps on a cheap Android. Firefox still
     has animation-timeline behind a flag, so those browsers get the same reveal
     from an IntersectionObserver instead. Never a scroll event handler.

     The head decides which path runs and sets .reveal-js there, synchronously,
     before anything paints. Nothing is hidden unless that class is present, so
     if this file fails to load the page still renders finished. */

  if (!document.documentElement.classList.contains('reveal-js')) return;

  var targets = document.querySelectorAll('.reveal');
  if (!targets.length) return;

  var io = new IntersectionObserver(function (entries) {
    for (var i = 0; i < entries.length; i++) {
      if (!entries[i].isIntersecting) continue;
      entries[i].target.classList.add('is-in');
      io.unobserve(entries[i].target);
    }
  }, { rootMargin: '0px 0px -12% 0px', threshold: 0.05 });

  for (var i = 0; i < targets.length; i++) io.observe(targets[i]);
})();
