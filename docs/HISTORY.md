# Gifty build history

Narrative, appended per release. Read on demand and grepped, never wholesale.
The contract, the standing rules and the live state live in `CLAUDE.md`.

---

## v0.1.0 . P1 foundation and design system

2026-08-31. First build. Ships an empty but correctly tokened shell with a real
homepage skeleton, plus the release gate that enforces the standing rules.

### What landed

- `.github/workflows/static.yml` with a literal `cp` allowlist, `.nojekyll`,
  `CNAME`, `404.html`, `.gitignore`.
- `css/tokens.css`. The full palette from BRIEF section 05, the fluid type scale,
  the space and radius scales, two elevation levels, and the motion ladder.
- `css/base.css`. Reset, typography, focus, layout primitives, the reveal system.
- `css/home.css` and `index.html`. Header, hero with a static product stage,
  the five products, three steps, the two delivery zones, footer.
- Type. **Bricolage Grotesque + Inter** chosen from the three candidate pairings,
  plus **Caveat** reserved for the gift card message preview and nothing else.
  All three self hosted as latin subset variable WOFF2, no network request to
  Google. 131KB, 48KB and 75KB. Bricolage and Inter are preloaded, Caveat is not
  referenced by any rule yet so it never downloads.
- `js/firebase-config.js` and `firestore.rules`, both written, neither wired to a
  real project yet.
- `tools/check-release.mjs`.

### Type pairing, decided

Bricolage Grotesque is a variable face with weight, width and optical size axes,
so one 131KB file covers every headline weight the site will ever need. Instrument
Serif has no bold and would have limited the hierarchy. General Sans and Satoshi
are Fontshare, which is a second vendor for no gain. Decided, do not relitigate.

### The release gate

`node tools/check-release.mjs` fails the build on any of:

- a VERSION that is not `x.y.z`, or a missing root file, or a wrong CNAME
- an asset reference that does not resolve, carries no `?v=`, or is stale
- a runtime file that is not in the `cp` allowlist, which is the single easiest
  thing to forget here and 404s only in production
- an em dash in any shipped file
- a banned marketing word in any HTML
- a physical CSS property where a logical one exists
- any required colour pair that misses AA, computed rather than eyeballed
- a `:focus-visible` rule that does not set a real outline
- a `.gitignore` that stops covering a local only file, or a server side secret
  that has leaked into a shipped file

It was negative tested before being trusted: an unlisted file in `css/`, a stale
`?v=`, and an em dash each produced the expected failure.

### Three real bugs the verification caught

**1. `--ink-faint` on `--paper-warm` is 4.34:1 and fails AA.** The token is rated
4.55:1 against `--paper` only, and warm sections drop it under the line. The
delivery footnote was sitting in exactly that pair. Fixed by using `--ink-soft`
on warm grounds, the same way white on `--teal` is banned rather than repaired.
The checker now reports the pair and fails the build if any rule puts those two
together.

**2. The scroll reveal failed invisible.** This one matters and it generalises.

A `view()` ViewTimeline reports `currentTime: null` whenever its subject sits far
outside the scrollport, and while the timeline is inactive the animation applies
nothing at all. The first version put the hidden state in a static rule:

```css
.reveal { opacity: 0; animation: reveal-in linear both; animation-timeline: view(); }
```

so any element the timeline had gone inactive for fell back to `opacity: 0` and
stayed there. Measured at 1280x720: six on screen elements fully invisible at
mid page and six more at the page bottom. The section headings and the product
tiles were blank.

The fix is to let the keyframes own the hidden state and leave the base visible:

```css
.reveal { opacity: 1; }
.reveal { animation: reveal-in linear both; animation-timeline: view(); }
@keyframes reveal-in { from { opacity: 0 } to { opacity: 1 } }
```

An active timeline still gives the full reveal, because the before phase of a
`both` fill applies the `from` keyframe. An inactive timeline now applies nothing
and the element renders visible. Same principle for the observer fallback: the
hidden class `.reveal-js` is set by an inline head script that runs only when the
observer path will really run, so a browser that runs neither path gets a
finished page rather than a blank one.

Verified both ways. With the old static rule, 6 on screen elements at opacity 0.
With the fix, zero at every scroll position on desktop and at 375px.

**3. The focus ring was silently absent on every button.** A bare `:focus-visible`
rule has specificity 0-1-0, which is exactly the specificity of `.btn--primary`
and `.skip-link`. Both set their own `box-shadow` for elevation and both appear
later in the file, so the box-shadow ring lost the cascade and focused buttons
had no visible ring at all. Confirmed with a real keyboard Tab, not a programmatic
`.focus()`, which does not match `:focus-visible` and would have hidden this.

Fixed by making the ring an `outline`, which no component shadow can override and
which follows `border-radius` on its own. The checker now fails the build if the
`:focus-visible` rule stops setting a real outline.

### Deferred, on purpose

- Firebase project values and the admin uid are `REPLACE_ME`. The checker warns
  rather than fails, because nothing on the site reads data yet.
- The Firestore rules deny order creation outright. P4 opens it together with the
  server side price re-derivation, rather than shipping a permissive rule early.
- Bricolage at 131KB is the largest asset on the page. Pinning the width and
  optical size axes with a font instancer would cut it, and that is a P5
  performance job, not a P1 one.

### v0.1.0 deployed

Pushed 2026-08-31. First run failed at `actions/configure-pages` with "Create Pages
site failed. Resource not accessible by integration": `enablement: true` cannot
create a Pages site with the default `GITHUB_TOKEN`. Created it once out of band
with `gh api -X POST repos/OWNER/REPO/pages -f build_type=workflow`, re-ran, green.

`CNAME` is deliberately held out of the `cp` allowlist while `giftylb.com` has no
DNS. Shipping it would set a custom domain that fails verification, and Pages then
redirects the working `github.io` URL to a dead one. `index.html` carries `noindex`
and has its `canonical` commented out for the same reason. All three revert together
the day the domain resolves.

Live at https://chaos-961.github.io/giftylb-website/ . Eleven files in the artifact,
every asset 200, a missing path 404s, and the 375px pass was repeated against the
live URL rather than only against localhost.

---

## v0.2.1 . P2 customizer engine, all five products

2026-08-31. One engine, five products, driven entirely by recipes.

### The shape of it

- `js/recipe.js` loads and **validates** a product recipe, and is the only file
  that knows where recipes come from. Moving the catalog into a database later
  is a change to `R.load` and nothing else.
- `js/engine/warp.js` is the whole surface story. There is exactly one warp: a
  per pixel gather. Every surface is expressed as a uv map, "for this screen
  pixel, which point of the artwork belongs here". A cylinder builds that from a
  formula, a flat panel from an inverse bilinear solve, a photographed product
  from an image. All three feed the same bilinear sampler. Coverage is
  supersampled 2x2 at build time and baked in, which is what stops the edge of a
  mug wrap crawling with jaggies.
- `js/engine/render.js` composites: grayscale base, colour parts tinted through
  their masks with `multiply`, print zones warped in and then shaded by the
  product's own luminance, then a `screen` gloss pass.
- `js/engine/design.js` renders the flat artwork in print space, in real
  millimetres, which is what makes the resolution gate honest and lets P4 export
  a print file from the same code path as the preview.
- `js/engine/photo.js`, `state.js`, `price.js` cover intake and the DPI gate,
  undo and autosave, and live pricing.

### Warp maps are built once

The uv map and the shading lookup depend only on the recipe, never on the
buyer's choices, so they are built once per product and only the gather runs per
frame. During a drag the gather runs at `step` 2 and fills blocks, then a clean
frame follows 90ms after the finger settles. The preview tracks the finger
rather than lagging it.

### Two photos of every upload

The working image stays full resolution for the preview and for the print file.
A copy downscaled to 1800px on the long edge is what autosave puts in
localStorage, because a phone camera JPEG does not fit and a silently failed
save is worse than a smaller one. On restore, `natW/natH` are taken from the
copy that actually survived, so the resolution gate reports what will really
print rather than what was originally uploaded.

### Bugs found by verifying

- **Every product priced at $12.** The price was only ever computed from a change
  handler, so before the first interaction the markup's placeholder stood as the
  price of the whole catalog. Now priced on boot.
- **The canvas was blank in a background tab.** The first draw went through
  `requestAnimationFrame`, which does not fire in a hidden tab. Draw directly on
  boot instead.
- **Every tab panel visible at once.** `.cz-panel { display: flex }` silently
  outranks the user agent's `[hidden]` rule. Fixed globally in `base.css` with
  `[hidden] { display: none !important }`, because this bites any component that
  sets `display`.
- **A white mug rendered grey.** The grayscale cylinder falloff sat in the mid
  greys, and `multiply` by `#FFFFFF` is a no-op, so the lightest colour in the
  palette showed the raw art. The base art now runs light and every darker colour
  multiplies down from there.
- **Stale controls after undo.** Undo moved the design back but left the colour
  swatch still showing the old selection, which is a lie about the state. Every
  control now re-syncs from the design.
- **The canvas overflowed the stage on short viewports.** `max-block-size: 100%`
  on a canvas with an intrinsic ratio does not reliably contain it. Absolute
  positioning plus `object-fit: contain` does.

### Gate

Renderer snapshotted while the mug was the only product, then cap, bottle, tote
and photo block were added as recipes and art. `diff` of `js/engine/` and
`js/recipe.js` is **empty**, and all seven sha256 hashes are unchanged.

The UI grew a zone picker and `accepts` aware tabs, which is `js/customize.js`,
not the renderer. The photo block needs it: it has two print zones, a UV printed
acrylic face and an engraved caption on the base.

### Release checks added

`check-release.mjs` now also parses every recipe and fails when an asset a recipe
names is missing or absent from the `cp` allowlist. Nothing else could catch it,
because recipes are fetched by JS. It also proves `<meta name="version">` matches
`VERSION`, since that meta is what stamps `?v=` onto recipe assets. Page to page
`.html` links are exempt from cache busting: a document is an entry point, and
busting it would only break bookmarks.

---

## v0.2.3 . P3 shop, templates, cart

2026-08-31. Browse by occasion, by who it is for, or by the thing itself. Every
card is a live render of the real design. A cart that survives a refresh with no
account and no backend.

### The shape of it

Three new data documents, all in the shape their Firestore counterparts will
take in P4, so the admin editor writes these and nothing downstream changes:

- `data/settings.json` is `settings/global`. Lead times, zones, fees, the cutoff
  hour, blackout dates, the occasion and recipient vocabularies. Nothing about
  delivery is hardcoded anywhere else.
- `data/templates.json` is `templates/{id}`. A template is a saved design:
  `productId`, `occasions[]`, `recipients[]`, and a `state` in exactly the shape
  `State.snapshot` produces. Twelve of them across the five products.
- Recipes are unchanged. `js/engine/*` and `js/recipe.js` are untouched.

Four new runtime files, and the customizer's interface layer changed:

- `js/delivery.js`. The promise. Counts working days in the shop's own timezone
  through `Intl`, not the buyer's, because the cutoff belongs to Beirut.
- `js/cart.js`. The store, the header badge, cross tab sync.
- `js/shop.js`, `js/cart-page.js`, `shop.html`, `cart.html`.
- `css/chrome.css`, lifted out of `home.css` when three pages started needing a
  header. `css/shop.css` covers the shop and the cart.

### Template cards are the product, not a picture of it

Every card renders its design through the same `Render.draw` the customizer
uses, so a card cannot drift from what the buyer gets and no product photography
is needed to launch the catalogue. One 900x700 scratch canvas is reused for
every card and the result is drawn down into the card's own 360px one: twelve
cards at engine resolution would be about forty megabytes of canvas on a phone.
Painting is one card per frame behind an `IntersectionObserver`, with a straight
paint when there is no observer so a card can never shimmer forever.

Template prices are computed as the finished thing, with a photo assumed in
every zone that accepts one, rather than quoting a number that jumps the moment
the buyer adds theirs.

### The cart is localStorage, and that is the right answer

Anonymous auth is still switched off on the project. Re-probed on the day:

```
POST identitytoolkit accounts:signUp -> {"error":{"code":400,"message":"ADMIN_ONLY_OPERATION"}}
```

It would not have been the store anyway. Anonymous auth buys continuity across
devices; it does not buy surviving a refresh, and localStorage does that for
free, offline, at zero Firestore reads. The write path has a shrink ladder: on
a quota failure the cart re-encodes its photos at 1400, then 1000, then 700px
and retries, and only then tells the buyer, blaming the phone's storage and not
them. The resolution gate always re-reads the pixels that are really there, so
a shrunk photo cannot be reported as print ready.

### Template to design carries the design with it

`@view-transition { navigation: auto }` in `chrome.css` on both ends, and the
tapped card's canvas takes `view-transition-name: product-preview` on the way
out, which is also the name on the customizer's `#preview`. Browsers without
cross document view transitions just navigate. Reduced motion cancels the
animation on the pseudo elements.

The URL is what says which design a customizer screen is showing. `?t=` applies
a template, `?c=` reopens a cart item for editing, and both clear the autosave
first, so a refresh lands on the same design instead of restoring whatever was
saved for that product last.

### 375px, where the fold nearly ate the catalogue

First measurement put the top of the grid at **769px** on a 375x812 screen: a
buyer would have scrolled past a whole screen of chrome before seeing one
product. Four changes brought it to **647px**, with the first row of cards
165px above the fold:

- the page eyebrow went, the lede went from three lines to two
- the two zone chips became one native select, which is also now the single
  zone control on both the shop and the cart, `Delivery.zoneSelect`
- `Show everything` only appears once a filter is actually set
- the gap between filter rows dropped one step

### Release checks added

`check-release.mjs` section 5c validates `settings.json` and every template
against the recipes: unknown product, unknown zone, unknown colour part, a hex
outside a part's palette, text over the rule's `maxChars`, a font the zone does
not allow, a text colour outside the zone palette, size or y outside what the
controls offer, a template shipping a photo, and a template that would draw
nothing. Negative tested with four deliberate breakages, all four caught.

`checkRef` now strips fragments, so `index.html#how` is a page link and not a
missing file.

### Gate

Template tap to finished design, scripted end to end and timed over three runs:

```
tap to interactive     74 / 71 / 75 ms
photo placed          124 / 119 / 140 ms
name typed, priced      1 /   0 /   1 ms
total                 199 / 190 / 216 ms
```

That is machine time only, on this desktop over localhost. It leaves about
29.8 of the 30 second budget for the human. The thumb on a real phone over a
real network is the outstanding half of this gate.

Route JS, gzipped: homepage 4.3KB, shop 20.3KB, cart 10.8KB, customizer 26KB.
The storefront budget is 120KB.

### Bugs found by verifying

- The loading word lived inside `#resultsCount`, which `renderResults` rewrites.
  Reaching for that span afterwards threw, and the catch hid the whole grid.
- Cart thumbnails were `loading="lazy"` data URLs. Lazy saves no network on
  something already in memory and only delays the paint.
- Reduced motion froze the card sheen with `animation: none`, which leaves a
  permanent white diagonal band on the tile. It now drops the pseudo element.
- The delivery line sat after the price bar, which is the element carrying the
  safe area inset, so on a notched phone it would have sat under the home
  indicator. Moved above it.
- Two mugs in a cart looked identical. The row now leads with the design's own
  words and falls back to the price breakdown only when there are none.

---

## v0.2.4 . P4 proof, orders, and admin

2026-08-31. A buyer can approve a proof and place an order. The shop can see it,
move it, message the buyer and print it. Nothing about the money is taken from
the browser.

### The catalogue moved into the database

P2 said moving the catalogue would be a change to `loadRecipe` and nothing else.
That held. `js/data.js` reads the REST endpoint directly, no SDK, and decodes
the wire format; `Recipe.load`, `Recipe.all`, `Delivery.load` and the template
lookup now go through it. The shop route grew from 20.3KB to 23.4KB gzipped for
the whole change.

It had to move. The order rule prices from a products read, and the admin
recipe editor writes products. A copy in the repo would have been a second
answer to what a mug costs, and the two would have parted on the first edit. So
`data/` is now the **seed**, pushed once by `tools/seed-firestore.mjs`, and it
is deliberately **not deployed**: shipping it would publish a slowly rotting
price list. `check-release.mjs` stopped treating `data/` as a runtime directory
and kept validating it as the seed.

Two things the wire format forced:

- Firestore cannot nest an array in an array, and a quad is four pairs. Quads
  are stored as four `{x,y}` maps and turned back into the engine's `[[x,y]]` in
  `Recipe.normalize`. The renderer never sees the wire format. The encoder
  throws on any other nested array rather than failing as an opaque 400.
- The catalogue is cached for sixty seconds. Long enough that moving between
  the shop, a design and the cart costs one read; short enough that a price edit
  reaches buyers within a minute. A stale price is caught at order time, not
  charged.

### Who is allowed to write an order

The brief sketched the browser writing the order with the rule policing the
price. That leaves a public write path Turnstile cannot protect, because a bot
skips the Worker and posts to the database directly. So the Worker signs in as
its own account and the rule accepts a create only from that uid. There is now
no public write path at all.

Both layers still check the money independently, which is what the gate asks:

- **The rule** validates shape, types, string lengths, the arithmetic in
  `totals`, and a per item price bound read live from `products/{id}`. Rules
  cannot loop, so they cannot evaluate a product's pricing clauses against a
  buyer's configuration. They can bound it, between `basePrice` and
  `basePrice + maxExtras`.
- **The Worker** derives the exact figure from the same documents with the same
  code the customizer priced with, plus the zone and fee from settings.

`maxExtras` is derived, so it is recomputed on every catalogue write, by the
seeder and by the admin. `tools/test-parity.mjs` proves the bound actually
bounds: the dearest design a buyer can reach is inside the ceiling for all five
products.

The cart is capped at six because the rule does one `get()` per item and rules
allow ten document accesses per request.

### Two copies of the price, kept honest

`js/engine/price.js` is a script tag IIFE and the Worker is a module, with no
build step between them, so the price and the delivery date exist twice.
`tools/test-parity.mjs` runs both files over every product, every template,
every colour swatch, every line count and 400 days x 4 times of day:

```
93 designs priced by both, every total identical
16000 dates computed by both, every label identical
```

It immediately earned its keep. The same `Intl` options render as `Fri 4 Sept`
in Chrome and `Fri, 4 Sept` in Node, so the card said one thing and the
confirmation email would have said another. Both now build the label from
`formatToParts` instead of taking the formatted string.

### The gate, run for real

`tools/test-order.mjs` runs the real Worker source against a real database
running the real `firestore.rules`, with only Turnstile, the image host and the
mail sender stubbed. 38 checks, including the whole of the tamper story:

```
TAMPERED PRICES
  ok  a tampered unit price is refused    409 price_changed was $1 now $16.5
  ok  a tampered total is refused         409 total_changed was $1 now $20.5
  ok  an order that claims no price at all is still priced by us   $20.5

THE RULE ON ITS OWN, WORKER BYPASSED
  ok  the rule refuses a price under the product base      403 PERMISSION_DENIED
  ok  the rule refuses a price over the product ceiling    403 PERMISSION_DENIED
  ok  the rule refuses totals that do not add up           403
  ok  the rule refuses a product that is not in the catalogue  403
  ok  an unauthenticated create is refused                 403
  ok  even the shop account cannot create an order         403
  ok  an order cannot be born already delivered            403
  ok  the rule caps an order at six things                 403
  ok  the same order number cannot be written twice        200 then 409
```

`createdAt` is a `REQUEST_TIME` transform, which is the only way it can equal
`request.time` the way the rule insists, because the Worker cannot know the
server's clock before it writes. `currentDocument.exists = false` makes a
duplicate number a 409 rather than an overwrite.

Then `tools/dev-worker.mjs` puts the same Worker on localhost so the real
checkout screen could be driven in a real browser at 375px. That produced a real
order: three uploads, two emails, one document.

### Order numbers are five digits, not four

The brief shows `GFT-4821`. The tracking link needs no login by design, so the
number is the only thing between a stranger and someone else's order page. Five
digits keeps it sayable over the phone and makes sweeping the space ten times
the work. The lookup endpoint returns no address, no phone and no email either
way, and the rule accepts four to six so nothing has to change if that is
revisited.

### Bugs found by verifying

- **The admin encoder stripped `id` from nested maps.** A document's id is the
  last part of its path, not a field, so the encoder dropped it. It dropped it
  from every nested map too, and the first settings save silently deleted the id
  off both delivery zones, every occasion and every colour part. The shop front
  then refused every order with "please choose where it is going". Stripping now
  happens once, at the top level, in `forSaving`.
- **The buyer's own photo was not on the order.** Only the proof and the print
  file went up, so the shop could print but never re-crop without asking the
  buyer for the picture again. Photos now upload alongside, and the order
  carries three distinct images per item.
- **A missing `shopEmail` was silent.** Nobody in the workshop would have been
  told an order existed. It is now reported back in the response.
- **The supplier check was too broad, then too narrow.** No screen may name the
  backend, but the dashboard has to call three service hostnames. The check now
  strikes out those three and fails on any other mention. It caught its own
  test edit, which is how it should behave.
- **The secret hint fired on `env.TURNSTILE_SECRET`.** A name is not a secret.
  The hints now require a name followed by a literal, and that was negative
  tested with a real looking key.

### Route JS, gzipped

```
homepage 4.3KB   shop 22.9KB   cart 13.6KB
customizer 28.4KB   checkout 27.5KB   track 6.3KB
```

The storefront budget is 120KB.

---

## v0.2.5 . Seven bugs

2026-08-31. A bug hunt over the P3 and P4 code. One of them was printing the
wrong thing.

### The proof was rendered in the wrong lettering

The worst of them, and it had shipped. Three templates use the handwriting
face, and `Caveat` was **not loaded on any page that draws text into a canvas**:

```
after document.fonts.ready resolved
  shop        display true   ui true   hand FALSE
  customizer  display true   ui true   hand FALSE
  checkout    display true   ui true   hand FALSE
```

An `@font-face` that no CSS rule uses is never fetched, so `document.fonts.ready`
resolves perfectly happily without it, and a canvas asked for a family it does
not have falls back in silence. The shop card, the preview, the proof the buyer
approves and the print file the workshop prints were all in a fallback cursive.
Measured on a 60px line, the fallback was **139px wider than Caveat**, 36% out,
which on the mug wrap means text that does not fit the zone it was laid out for.

`document.fonts.ready` was never going to fix it. `Design.ready()` now asks for
every face the renderer can draw, **by name**, which is what triggers the fetch,
and the shop, the customizer and the checkout all wait on it. The checkout waits
twice: once before showing the proof and once before turning it into files.

```
before Design.ready()   display false   ui true   hand false
after  Design.ready()   display true    ui true   hand true
```

### The other six

- **The cart's quota rollback could throw.** When the store was full, `Cart.add`
  popped the item and wrote again, using the same write that had just failed.
  That threw out of a promise nobody was catching and left the button stuck.
- **The shop edited the cached settings.** `settings.products = filter(...)`
  wrote back into the object held in the catalogue cache, so a product missing
  once stayed missing on every screen for the life of that cache. It keeps its
  own ordered list now.
- **An order said the shop placed it.** `statusHistory[0].by` was `shop` on an
  order the buyer had just placed.
- **The admin's product picker gained a listener per refresh.** Three refreshes
  and one pick redrew the form four times.
- **The admin listed the newest 300 orders and said nothing about the rest.** A
  silent cap reads as "that is all of them". It says so now when it is full.
- **An order could be moved to a status nothing can draw.** The update rule
  checked the money but not the status, so a typo in the admin would have put a
  raw word in front of a buyer on the tracking page. The rule now holds it to
  the six the tracking page knows.

Three checks added to `tools/test-order.mjs` for the last one:

```
ok  the shop may move an order along
ok  an order cannot be moved to a status nothing can draw
ok  the server identity cannot move an order at all
```

`tools/test-order.mjs` 41 passed, 0 failed. `tools/test-parity.mjs` 16103
agreed, 0 disagreed. `check-release.mjs` exits 0.
