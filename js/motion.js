/* Gifty. The pointer and the page.
 *
 * Four behaviours, and the reason they are script rather than CSS is that all
 * four need a number CSS cannot work out on its own: where the cursor is, how
 * many words a headline has, where a finger landed.
 *
 *   split    an h1 becomes one span per word, so the line can deal itself out
 *   tilt     a card leans toward the cursor and carries a highlight
 *   magnet   a call to action drifts a few pixels toward the cursor
 *   ripple   a press puts a circle where the finger was
 *
 * Every one of them is additive. Nothing in this file hides anything, nothing
 * removes anything from the document, and every class it sets is one it also
 * takes away. A page where this file failed to load is the page without the
 * polish, never a broken one. That is not a nice-to-have here: the reveal rules
 * in base.css are written the same way for the same reason.
 *
 * None of it runs under prefers-reduced-motion, and the two pointer behaviours
 * are gated on a fine pointer as well, because leaning a card toward a finger
 * that is already on top of it does nothing but fight the tap.
 */
(function () {
  'use strict';

  var reduced = window.matchMedia &&
                window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var fine = window.matchMedia &&
             window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  /* ------------------------------------------------------------------ split

     One span per word, wrapped in a second span that does the clipping. Two
     elements rather than one because the animation translates the word up from
     behind its own line box, and something has to stay still to clip against.

     Only ever runs on an element that is plain text. A headline carrying a
     link or a break is left exactly as it is rather than being rebuilt wrong,
     because a headline is the one thing on the page nobody would forgive. */

  function split(el) {
    if (el.children.length) return;
    var text = el.textContent.trim();
    if (!text || text.length > 90) return;

    var words = text.split(/\s+/);
    var frag = document.createDocumentFragment();

    words.forEach(function (w, i) {
      var outer = document.createElement('span');
      outer.className = 'word';
      var inner = document.createElement('span');
      inner.textContent = w;
      inner.style.setProperty('--w', String(i));
      outer.appendChild(inner);
      frag.appendChild(outer);
      if (i < words.length - 1) frag.appendChild(document.createTextNode(' '));
    });

    el.textContent = '';
    el.appendChild(frag);
    el.classList.add('is-split');
  }

  /* ------------------------------------------------------------------- tilt

     Everything is written into custom properties and the card decides what to
     do with them, which keeps the geometry here and the look in the stylesheet.
     --tx and --ty run minus one to one from the centre. --px and --py are the
     pointer in percent, for the highlight.

     The values are set on a pointermove, which fires at whatever rate the
     device runs, and the whole cost is four setProperty calls and a compositor
     transform. No rAF, no layout read per move: the rect is measured once on
     pointerenter and again only if the card has moved. */

  function tilt(card) {
    var rect = null;

    function measure() { rect = card.getBoundingClientRect(); }

    card.addEventListener('pointerenter', function () {
      measure();
      card.classList.add('is-tilting');
      card.style.setProperty('--sheen', '1');
      card.style.setProperty('--tz', '-4px');
    });

    card.addEventListener('pointermove', function (e) {
      if (!rect) measure();
      var x = (e.clientX - rect.left) / rect.width;
      var y = (e.clientY - rect.top) / rect.height;
      card.style.setProperty('--tx', (x * 2 - 1).toFixed(3));
      card.style.setProperty('--ty', (y * 2 - 1).toFixed(3));
      card.style.setProperty('--px', (x * 100).toFixed(1) + '%');
      card.style.setProperty('--py', (y * 100).toFixed(1) + '%');
    });

    card.addEventListener('pointerleave', function () {
      card.classList.remove('is-tilting');
      card.style.setProperty('--tx', '0');
      card.style.setProperty('--ty', '0');
      card.style.setProperty('--tz', '0px');
      card.style.setProperty('--sheen', '0');
      rect = null;
    });
  }

  /* ----------------------------------------------------------------- magnet

     The button leans toward the cursor by a few pixels while the cursor is
     near it. It is doing one job and it is not decoration: it makes the primary
     action on a screen the thing the pointer is drawn to, which on a page with
     one obvious next step is exactly the right hint.

     The pull is capped at a third of the button's own size, so it never leaves
     its own hit box and a click that looked like it would land always does. */

  function magnet(btn) {
    var rect = null;

    btn.addEventListener('pointerenter', function () { rect = btn.getBoundingClientRect(); });

    btn.addEventListener('pointermove', function (e) {
      if (!rect) rect = btn.getBoundingClientRect();
      var dx = (e.clientX - (rect.left + rect.width / 2)) / rect.width;
      var dy = (e.clientY - (rect.top + rect.height / 2)) / rect.height;
      var px = Math.max(-10, Math.min(10, dx * 22));
      var py = Math.max(-6, Math.min(6, dy * 14));
      /* Custom properties, not an inline transform. An inline transform is the
         highest specificity there is and it silently deletes the press scale
         and the hover lift, so the one button on the screen that most needs to
         confirm a tap stops confirming it. */
      btn.style.setProperty('--mx', px.toFixed(1) + 'px');
      btn.style.setProperty('--my', py.toFixed(1) + 'px');
    });

    btn.addEventListener('pointerleave', function () {
      btn.style.setProperty('--mx', '0px');
      btn.style.setProperty('--my', '0px');
      rect = null;
    });
  }

  /* ----------------------------------------------------------------- ripple

     Delegated, so it covers buttons that do not exist yet. Everything in this
     project builds its lists at runtime, and binding per button would cover the
     header and miss every card in the shop. */

  function ripple(e) {
    var btn = e.target.closest && e.target.closest('.btn');
    if (!btn || btn.disabled) return;
    var rect = btn.getBoundingClientRect();
    btn.style.setProperty('--rx', (e.clientX - rect.left).toFixed(0) + 'px');
    btn.style.setProperty('--ry', (e.clientY - rect.top).toFixed(0) + 'px');
    btn.classList.remove('is-rippling');
    void btn.offsetWidth;
    btn.classList.add('is-rippling');
  }

  document.addEventListener('animationend', function (e) {
    if (e.animationName === 'btn-ripple' && e.target.classList) {
      e.target.classList.remove('is-rippling');
    }
  }, true);

  /* -------------------------------------------------------------------- go */

  function start() {
    var i, nodes;

    nodes = document.querySelectorAll('[data-split]');
    for (i = 0; i < nodes.length; i++) split(nodes[i]);

    if (reduced) return;

    document.addEventListener('pointerdown', ripple);

    if (!fine) return;

    nodes = document.querySelectorAll('[data-tilt]');
    for (i = 0; i < nodes.length; i++) tilt(nodes[i]);

    nodes = document.querySelectorAll('[data-magnet]');
    for (i = 0; i < nodes.length; i++) magnet(nodes[i]);
  }

  /* Every list this touches is either in the markup or built by a script that
     runs on DOMContentLoaded, so binding new cards is a second pass the pages
     that build lists ask for by hand. */
  window.Gifty = window.Gifty || {};
  window.Gifty.Motion = {
    bind: function (root) {
      if (reduced || !fine) return;
      var nodes = (root || document).querySelectorAll('[data-tilt]');
      for (var i = 0; i < nodes.length; i++) {
        if (nodes[i].dataset.tilted) continue;
        nodes[i].dataset.tilted = '1';
        tilt(nodes[i]);
      }
    },
    split: split
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
