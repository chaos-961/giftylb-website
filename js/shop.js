/* Gifty. The shop.
 *
 * Browse by occasion, by who it is for, or by the thing itself. Every card is
 * a real design rendered by the same engine that draws the customizer, so the
 * picture on the card is the product, not an illustration of it, and it cannot
 * drift from what the buyer gets.
 *
 * Templates are data. This file never names one.
 */
(function (G) {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var settings = null;
  var order = [];             /* product ids, in the order the shop shows them */
  var recipes = {};          /* id -> recipe */
  var templates = [];
  var prepared = {};         /* id -> { images, cache } */
  var scratch = document.createElement('canvas');

  var filters = { occasion: null, recipient: null, product: null };
  var cards = [];            /* { el, dateEl, leadTimeDays } */
  var queue = [];
  var painting = false;
  var observer = null;

  /* ------------------------------------------------------------------ price

     A template is priced as the finished thing. Its photo slots are empty
     because the buyer brings the photo, so the estimate assumes they will,
     rather than quoting a number that goes up the moment they do. */

  function templatePrice(recipe, state) {
    var asFinished = { productId: state.productId, colors: state.colors, zones: {} };
    Object.keys(state.zones).forEach(function (id) {
      var zone = recipe.printZones.filter(function (z) { return z.id === id; })[0];
      var accepts = (zone && zone.accepts) || [];
      asFinished.zones[id] = {
        text: state.zones[id].text,
        photo: accepts.indexOf('photo') >= 0 ? { image: true } : null
      };
    });
    return G.Price.compute(recipe, asFinished);
  }

  function todoFor(recipe, state) {
    var wantsPhoto = recipe.printZones.some(function (z) {
      return (z.accepts || []).indexOf('photo') >= 0 && !(state.zones[z.id] || {}).photo;
    });
    return wantsPhoto ? 'Add your photo' : 'Swap the name';
  }

  /* --------------------------------------------------------------- painting

     One full size scratch canvas is reused for every card, and the result is
     drawn down into the card's own small one. Twelve cards at the engine's
     900 by 700 would be forty megabytes of canvas on a phone. */

  function ensure(productId) {
    if (prepared[productId]) return Promise.resolve(prepared[productId]);
    var recipe = recipes[productId];
    prepared[productId] = G.Recipe.loadImages(recipe).then(function (images) {
      var entry = { images: images, cache: G.Render.prepare(recipe, images) };
      prepared[productId] = Promise.resolve(entry);
      return entry;
    });
    return prepared[productId];
  }

  function paintCard(art) {
    var recipe = recipes[art.dataset.product];
    var state = JSON.parse(art.dataset.design);

    return ensure(recipe.id).then(function (p) {
      var view = recipe.views[0];
      G.Render.draw(scratch, recipe, p.cache, p.images, state, 1);

      var canvas = document.createElement('canvas');
      canvas.width = 360;
      canvas.height = Math.round(360 * view.h / view.w);
      canvas.getContext('2d').drawImage(scratch, 0, 0, canvas.width, canvas.height);
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', art.dataset.alt);

      art.textContent = '';
      art.appendChild(canvas);
      art.removeAttribute('data-state');
    });
  }

  /* One card per frame. A phone that scrolls into six cards at once should
     keep scrolling while they arrive, not freeze for six warps. */
  function pump() {
    if (painting || !queue.length) return;
    painting = true;
    var art = queue.shift();
    paintCard(art)
      .catch(function () { art.removeAttribute('data-state'); })
      .then(function () {
        painting = false;
        if (queue.length) requestAnimationFrame(pump);
      });
  }

  function watch(art) {
    /* No observer, no lazy. Paint it rather than leave a card shimmering at
       something that is never going to arrive. */
    if (!('IntersectionObserver' in window)) {
      queue.push(art);
      pump();
      return;
    }
    if (!observer) {
      observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (!e.isIntersecting) return;
          observer.unobserve(e.target);
          queue.push(e.target);
          pump();
        });
      }, { rootMargin: '200px 0px' });
    }
    observer.observe(art);
  }

  /* ----------------------------------------------------------------- filters */

  function matches(t) {
    if (filters.product && t.productId !== filters.product) return false;
    if (filters.occasion && t.occasions.indexOf(filters.occasion) < 0) return false;
    if (filters.recipient && t.recipients.indexOf(filters.recipient) < 0) return false;
    return true;
  }

  function syncUrl() {
    var q = new URLSearchParams();
    if (filters.occasion) q.set('occasion', filters.occasion);
    if (filters.recipient) q.set('for', filters.recipient);
    if (filters.product) q.set('p', filters.product);
    var url = location.pathname + (q.toString() ? '?' + q : '');
    history.replaceState(null, '', url);
  }

  function chipRow(container, options, key) {
    container.textContent = '';
    var all = [{ id: null, name: 'All' }].concat(options);
    all.forEach(function (opt) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = opt.name;
      b.setAttribute('aria-pressed', String(filters[key] === opt.id));
      b.addEventListener('click', function () {
        filters[key] = filters[key] === opt.id ? null : opt.id;
        [].forEach.call(container.children, function (c, i) {
          c.setAttribute('aria-pressed', String(filters[key] === all[i].id));
        });
        syncUrl();
        renderResults();
      });
      container.appendChild(b);
    });
  }

  /* ----------------------------------------------------------------- results */

  function renderResults() {
    var grid = $('designs');
    var found = templates.filter(function (t) { return t.published && matches(t); });

    grid.textContent = '';
    cards.length = 0;
    queue.length = 0;
    if (observer) { observer.disconnect(); observer = null; }

    $('resultsCount').textContent = found.length === 1
      ? '1 design' : found.length + ' designs';
    $('noResults').hidden = found.length > 0;
    /* Nothing to clear until something is set, and on a phone that button is
       60px of the fold that the first row of designs would rather have. */
    $('clearFilters').hidden = !(filters.occasion || filters.recipient || filters.product);

    found.forEach(function (t) {
      var recipe = recipes[t.productId];
      if (!recipe) return;
      var price = templatePrice(recipe, t.state);

      var li = document.createElement('li');
      li.className = 'design-card';

      var a = document.createElement('a');
      a.className = 'design-card__link';
      a.href = 'customize.html?p=' + encodeURIComponent(t.productId) + '&t=' + encodeURIComponent(t.id);

      var art = document.createElement('span');
      art.className = 'design-card__art';
      art.dataset.state = 'waiting';
      art.dataset.product = t.productId;
      art.dataset.alt = t.name + '. A ' + recipe.name.toLowerCase() + '.';
      /* The design itself rides on the element, so painting needs no lookup
         back into the template list and the card is self contained. */
      art.dataset.design = JSON.stringify(t.state);

      var body = document.createElement('span');
      body.className = 'design-card__body';

      var name = document.createElement('span');
      name.className = 'design-card__name';
      name.textContent = t.name;

      var meta = document.createElement('span');
      meta.className = 'design-card__meta';
      meta.textContent = recipe.name + ', ' + G.Price.format(price.total, price.currency);

      var todo = document.createElement('span');
      todo.className = 'design-card__todo';
      todo.textContent = todoFor(recipe, t.state);

      var ready = document.createElement('span');
      ready.className = 'design-card__ready';

      body.appendChild(name);
      body.appendChild(meta);
      body.appendChild(todo);
      body.appendChild(ready);
      a.appendChild(art);
      a.appendChild(body);
      li.appendChild(a);
      grid.appendChild(li);

      /* The tapped design is what carries into the customizer. Naming it here,
         on the way out, keeps the name unique: only one element on the page can
         hold it at a time. */
      a.addEventListener('click', function () {
        [].forEach.call(document.querySelectorAll('.design-card__art canvas'), function (c) {
          c.style.viewTransitionName = '';
        });
        var canvas = art.querySelector('canvas');
        if (canvas) canvas.style.viewTransitionName = 'product-preview';
      });

      cards.push({ ready: ready, leadTimeDays: recipe.leadTimeDays });
      watch(art);
    });

    paintDates();
  }

  /* ------------------------------------------------------------ the promise */

  function paintDates() {
    var zoneId = G.Cart.zone() || settings.defaultZone;
    var byLead = {};

    cards.forEach(function (c) {
      if (!byLead[c.leadTimeDays]) {
        byLead[c.leadTimeDays] = G.Delivery.promise(c.leadTimeDays, zoneId);
      }
      c.ready.textContent = 'Get it ' + byLead[c.leadTimeDays].label;
    });

    /* The bar quotes the fastest thing in the shop, because that is the one the
       sentence is true about. Only what the shop actually offers counts: the
       gift box is a recipe like any other but it is not sold on its own, and
       letting it in here would promise a date for something nobody can buy. */
    var quickest = Math.min.apply(null, (order.length ? order : Object.keys(recipes))
      .map(function (id) { return recipes[id].leadTimeDays; }));
    var p = G.Delivery.promise(quickest, zoneId);
    $('promiseLine').textContent = G.Delivery.sentence(p);
  }

  function buildZoneSwitch() {
    var box = $('zoneSwitch');
    box.textContent = '';
    box.appendChild(G.Delivery.zoneSelect('shopZone', G.Cart.zone(), function (id) {
      G.Cart.setZone(id).then(paintDates);
    }));
  }

  /* -------------------------------------------------- what a crawler reads

     Emitted here rather than written into shop.html, because the price and the
     description live in the database and a second copy in the markup would be a
     second answer to what a mug costs. Whatever the shop is showing a buyer is
     exactly what this says. */

  function paintStructuredData() {
    var origin = 'https://giftylb.com';
    var items = order.map(function (id, i) {
      var r = recipes[id];
      return {
        '@type': 'ListItem',
        position: i + 1,
        item: {
          '@type': 'Product',
          name: r.name,
          description: r.blurb || '',
          image: origin + '/' + r.views[0].baseImage,
          url: origin + '/customize.html?p=' + encodeURIComponent(id),
          brand: { '@type': 'Brand', name: 'Gifty' },
          offers: {
            '@type': 'Offer',
            price: String(r.basePrice),
            priceCurrency: r.currency || 'USD',
            availability: 'https://schema.org/InStock',
            url: origin + '/customize.html?p=' + encodeURIComponent(id)
          }
        }
      };
    });

    var node = document.createElement('script');
    node.type = 'application/ld+json';
    node.textContent = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: 'What Gifty makes',
      itemListElement: items
    });
    document.head.appendChild(node);
  }

  /* ------------------------------------------------------------------- boot */

  function readUrl() {
    var q = new URLSearchParams(location.search);
    filters.occasion = q.get('occasion');
    filters.recipient = q.get('for');
    filters.product = q.get('p');
  }

  function fail() {
    $('shopError').hidden = false;
    $('designs').hidden = true;
  }

  function boot() {
    readUrl();

    Promise.all([G.Delivery.load(), G.Data.collection('templates'), G.Recipe.all()])
      .then(function (all) {
        settings = all[0];
        templates = all[1];
        all[2].forEach(function (r) { recipes[r.id] = r; });
        /* settings.products is the order the shop shows them in, so a product
           the catalogue has but settings does not list simply is not offered.
           Kept beside the settings rather than written back into them: that
           object is the cached one, and editing it would quietly drop the
           product from every other screen too. */
        order = settings.products.filter(function (id) { return recipes[id]; });

        chipRow($('filterOccasion'), settings.occasions, 'occasion');
        chipRow($('filterRecipient'), settings.recipients, 'recipient');
        chipRow($('filterProduct'), order.map(function (id) {
          return { id: id, name: recipes[id].name };
        }), 'product');

        buildZoneSwitch();
        buildBlankRow();
        paintStructuredData();

        /* Text on a card is drawn into a canvas, and a canvas does not restyle
           itself when a webfont arrives. So wait for the faces first, by name:
           an unused @font-face is never fetched at all. */
        return G.Design.ready();
      })
      .then(function () {
        renderResults();
        setInterval(paintDates, 30000);
      })
      .catch(function (err) {
        fail();
        if (window.console) console.error(err);
      });

    $('clearFilters').addEventListener('click', function () {
      filters.occasion = filters.recipient = filters.product = null;
      chipRow($('filterOccasion'), settings.occasions, 'occasion');
      chipRow($('filterRecipient'), settings.recipients, 'recipient');
      chipRow($('filterProduct'), order.map(function (id) {
        return { id: id, name: recipes[id].name };
      }), 'product');
      syncUrl();
      renderResults();
    });
  }

  function buildBlankRow() {
    var row = $('blankRow');
    row.textContent = '';
    order.forEach(function (id) {
      var r = recipes[id];
      var a = document.createElement('a');
      a.href = 'customize.html?p=' + encodeURIComponent(id);
      var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 48 48');
      svg.setAttribute('aria-hidden', 'true');
      var use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
      use.setAttribute('href', '#i-' + id);
      svg.appendChild(use);
      a.appendChild(svg);
      a.appendChild(document.createTextNode('Blank ' + r.name.toLowerCase()));
      row.appendChild(a);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})(window.Gifty = window.Gifty || {});
