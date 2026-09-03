/* Gifty. Site wide behaviour.
   Deliberately small. The storefront JS budget is 120KB gzipped for the whole
   route, and the customizer in P2 is the thing that gets to spend it. */

(function (G) {
  'use strict';

  /* ---------------------------------------------------------- the engine loader

     Two files on the homepage want the drawing engine after the page has
     loaded: the hero, which assembles a mug, and the showcase, which renders
     the product grid. They overlap almost entirely, and each having its own
     loader meant data.js and recipe.js were fetched and executed twice, which
     wipes the catalogue cache the first one had just filled.

     So the loader lives here, in the one file every page already has, and it
     remembers what it has started. Asking for a file twice returns the same
     promise. The chain is sequential rather than parallel because these are
     plain script tag IIFEs that depend on each other in order. */

  var started = {};

  G.Engine = {
    need: function (list) {
      var version = (document.querySelector('meta[name="version"]') || {}).content || '';
      return list.reduce(function (chain, src) {
        return chain.then(function () {
          if (started[src]) return started[src];
          started[src] = new Promise(function (resolve, reject) {
            var s = document.createElement('script');
            s.src = src + (version ? '?v=' + version : '');
            s.onload = resolve;
            s.onerror = function () { reject(new Error(src)); };
            document.head.appendChild(s);
          });
          return started[src];
        });
      }, Promise.resolve());
    }
  };

  /* Footer year. */
  var year = document.getElementById('year');
  if (year) year.textContent = String(new Date().getFullYear());

  /* There is no analytics and no third party of any kind. This site talks to
     GitHub Pages, which is serving it, and to the database. That is the whole
     list, and it is checked by loading the site and counting hosts, not by
     trusting this comment. A Cloudflare beacon loader used to sit here behind
     an empty token; it never fired and it is gone, because a Cloudflare loader
     in a Firebase only site is a contradiction waiting to be switched on by
     accident.

     If analytics is ever wanted, pick something and add it deliberately. Do not
     restore this. */

  /* Scroll reveal fallback.
     The preferred path is the CSS scroll driven animation in base.css, which
     runs off the main thread and holds 60fps on a cheap Android. Firefox still
     has animation-timeline behind a flag, so those browsers get the same reveal
     from an IntersectionObserver instead. Never a scroll event handler.

     The head decides which path runs and sets .reveal-js there, synchronously,
     before anything paints. Nothing is hidden unless that class is present, so
     if this file fails to load the page still renders finished. */

  /* Lists built at runtime, on the shop and the cart, are not in the document
     when the observer below is wired, so they ask for a second pass once they
     have painted. On the scroll driven path there is nothing to do: a view()
     timeline attaches itself the moment the element exists. Defined before both
     early returns so a caller never has to know which path it got. */
  /* The observer itself moved to js/nav.js in v0.3.5, because every page has
     reveals now and only this one loaded this file. Nothing to do here. */
})(window.Gifty = window.Gifty || {});
