/* Gifty. Site wide behaviour.
   Deliberately small. The storefront JS budget is 120KB gzipped for the whole
   route, and the customizer in P2 is the thing that gets to spend it. */

(function () {
  'use strict';

  /* Footer year. */
  var year = document.getElementById('year');
  if (year) year.textContent = String(new Date().getFullYear());

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
