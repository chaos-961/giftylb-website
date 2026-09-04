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

---

# v0.2.6, P5. Gift box, signature moments, launch

## The gift box is a group, not a container

The obvious build is a bundle product that holds other products inside it. It
would have broken the order rule on the first order: every line has to price
against its own product document, and a bundle line cannot be bounded against
four different products at once.

So a box is a **group**. Two to four things the buyer already made, plus one
`gift-box` line carrying the ribbon and the card, all sharing a `boxId`. Nothing
about how an item is priced, edited, proofed or ordered changes because it is in
a box. The box itself is a sixth recipe drawn by the same engine, so it needed
no renderer change either: two colour parts and one quad zone for the card.

The saving is the only new number. It lives in `js/bundle.js` and, again as a
module, in `worker/src/price.js`, and `tools/test-parity.mjs` runs both over
twelve cart shapes including every way a group can be malformed. A group that is
not a real box earns nothing in both files, which is what stops the cart
promising a saving the Worker then refuses.

The builder is a picker over the cart rather than a second customizer. The
things are already made; what is left is which of them go in, what colour the
ribbon is, and what the card says.

## The rule could only ever accept a one line order

The find of the phase, and it had been shipped since P4.

Firestore caps a security rule at **1000 expression evaluations per request**.
The P4 order rule repeated `request.resource.data.items[i]` a dozen times per
line and called `get()` on the same product document three times inside one
function. A one item order fit. **A two item order did not**, and going over the
cap does not look like a bug: it comes back as a plain permission denied, which
reads exactly like a tampered price.

Nothing caught it because every order the P4 suite pushed through the Worker had
one line in it, and the seven line case was refused on size before the per item
checks ever ran.

What fixed it, in order of how much each bought:

- Every function takes what it checks as a **parameter** instead of reaching
  back into `request.resource.data`.
- The product document is read **once** per line and handed to the price check,
  not fetched three times.
- `hasOnly` against a nine string list, three length checked strings and a key
  count each cost about one line out of six. They are gone from the hot path;
  the money checks stayed.
- `exists()` beside the `get()` is redundant. A `get()` on a missing document
  returns null and reading a field off null denies the write anyway.
- `items.size()` is worked out once and passed down instead of being called a
  dozen times.

A full cart of six now evaluates with room for three more clauses.
`tools/probe-rule-cost.mjs` measures that and exits non-zero if it drops, and
`tools/test-order.mjs` has a six line order in it as a permanent regression.

A prototype that replaced the six product reads with one derived bounds document
bought only five more clauses, which did not pay for a second copy of the price
bounds that the admin would have to keep in step. It was dropped.

## The hero assembles itself, and fails visible

A blank mug, then the picture settles onto it and wraps, then the name types on.
It is a live render by the same engine that draws the customizer, so the
homepage cannot promise something the customizer does not make.

It costs the homepage nothing: `js/hero.js` waits for load, then pulls the engine
in on an idle callback. The static illustration in the markup is the real hero
until two finished canvases exist to replace it.

The first version put `opacity: 0` on the top layer and added a class in a
`requestAnimationFrame` to reveal it. **A rAF does not fire in a hidden or
background tab**, so a homepage opened in a second tab would have sat on a blank
mug until it was looked at. The keyframes own the hidden state now and the layer
is only added when it is going to animate.

That rule is now mechanical: `check-release.mjs` section 8b refuses any static
rule that sets `opacity: 0` or `visibility: hidden` unless it is inside a
keyframe, inside a `prefers-reduced-motion: no-preference` block, or on a class a
script adds. It caught the hero on the first run.

## Launch

- The share card is a real engine render of a mug, drawn at 1200x630 with the
  real fonts, not an illustration of one. `tools/make-images.html` draws it and
  the touch icon and posts them to the dev server, which writes the files.
- `LocalBusiness` on the homepage carries no telephone and no street address,
  because there is not a real one to give yet and an invented local listing is
  worse than none.
- `Product` structured data is emitted at runtime by `js/shop.js` from the
  recipes it already loaded. Writing it into the markup would have put a second
  price list in the repo, which is the thing `data/` was taken out of the deploy
  to avoid.
- Analytics is Cloudflare Web Analytics, cookieless, so there is no consent
  banner and there is not going to be one. While the token is empty nothing at
  all loads, so a site without analytics makes no third party request rather
  than a failing one.

---

# v0.2.8. Real 3D products, and the shop stops depending on a seeded database

Authorised in session on 2026-09-01: polish the front end, make every control
work, and put actual three dimensional models in the customizer.

## The reported bug was one line deep and three layers down

The console showed `products/mug returned 404` and the shop, the cart and the
customizer all said "We could not load the shop just now". The database is
empty, which was known and expected. What was not acceptable is that an empty
database is a blank shop.

Three separate things came out of that.

**The rules were never deployed with a real uid.** `firestore.rules` still said
`REPLACE_ME_ADMIN_UID`, so `tools/seed-firestore.mjs` signed in fine as the shop
account, uid `kLRVYNHHfjTznqB1gUq3yWbXbG82`, and was then refused by the rule on
its first write. The uid is filled in now. Deploying it needs `firebase login`,
which is an interactive browser flow, so that step is still the user's.

**The storefront now has a bundled fallback.** `tools/build-catalogue.mjs`
builds `data/catalogue.json` from the same seed files the seeder pushes, and it
is the one file under `data/` that ships. `js/data.js` serves it when a live
read fails or a collection comes back empty. The database still wins whenever it
has anything to say, and nobody is ever charged from the bundle: the Worker
re-derives every price from the live documents and the order rule bounds it from
the same place. `check-release.mjs` refuses a release where the bundle has
drifted from `data/`.

This is a deliberate softening of the "one answer to what a mug costs" rule from
P4. That rule was written against a second *editable* copy. A generated artefact
byte-checked against the seed on every release is not that, and a shop that is
briefly out of date beats a shop that is a blank page.

**The 404s themselves could not be fixed from JavaScript.** A 404 on `fetch` is
printed to the console by the browser and no `catch` silences it. Listing a
collection returns 200 with an empty body in exactly the situation a document
read 404s, so `Data.doc` for `products`, `templates` and `settings` now resolves
through `Data.collection`. Same answer, no red console, and fewer requests: the
shop, a design and the cart share one cached list instead of reading a document
each.

The fallback exposed one more thing on the way. `Data.bundleUrl` started as a
plain relative path, which resolves against the *document*, so it meant
`/admin/data/catalogue.json` inside the dashboard and broke under a project
pages subpath. It is worked out from `document.currentScript.src` now.

## The 3D engine

Two new files. No library, no build step, no vendored runtime.

`js/engine/mesh.js` builds geometry from three primitives and nothing else:

- **lathe**, a 2D profile revolved around Y, optionally through part of a turn.
  Mug body, bottle, cap crown, cap peak, lids, rings.
- **box**, a rounded box. Take a point on a sharp cube, clamp it into the box
  shrunk by the corner radius, push it back out by that radius along the
  direction between the two. A face centre does not move, an edge sweeps a
  quarter round, a corner sweeps an eighth of a sphere, and the direction that
  pushed it out is the surface normal. One formula, no special cases.
- **tube**, a circle swept along a 2D path. Mug handle, tote straps, ribbon.

`js/engine/scene.js` is the renderer: one WebGL program of about forty lines,
three lights, lit in linear space, a Blinn-Phong specular with a fresnel rim,
and a soft radial contact shadow on the floor.

The whole trick is the uv convention, and it is one sentence: **uv runs 0 to 1
across the part of a surface that can be printed and out of range everywhere
else.** For each printing part the renderer composites that part's zones into a
single canvas laid out in the part's own uv space and uploads it as one texture,
sized so the artwork lands at its own resolution rather than being squeezed into
a square. So the fragment shader does not sample a rectangle inside a rectangle.
It samples `vUv`, and the geometry has already decided where on a handle or a
lid that is. Which is nowhere.

A product's shape is a `model` block in its recipe, so all six were added the
same way the flat renderer's five were: as data.

## Four bugs the eye would have missed, and the two tools that caught them

**The box double-applied its axis signs.** `uu = us[c] * uSign` and then
`px = f.u[0] * uu` cancels the sign, so three of the six faces came out wound
inside out. With culling on they were simply absent, and the tote, the photo
block and the gift box rendered as flat sheets. The face table now satisfies
`u cross v = n` on every row, which makes all six faces counterclockwise seen
from outside at once and needs no per face flip.

**A closed solid was being drawn two sided.** The mug's underside fought its own
silhouette for the same pixels and drew a dotted line along the bottom edge.
Every part in this engine is a closed solid, so back faces are culled now. The
inside wall of a mug survives that: it is a front face, because the profile
turns over the rim and comes back down. That made winding load bearing, so the
cap peak had to be traced the other way round and the crown and both rings had
to be closed.

**The contact shadow was culled for every camera above the floor.** The quad
lies flat and its triangles face down. It survived the very first frame only
because WebGL starts with culling disabled, and vanished from every frame after.
Found by trying to measure the pitch direction and getting an answer that made
no sense.

**Undo did nothing for typing, sliders or photo drags.** `commit` took its undo
snapshot *after* the transient `touch` calls had already mutated the state, so
what went on the stack was the state the buyer was already looking at. Only
discrete changes like a colour swatch ever worked. `State.create` keeps a
`baseline` now, the design as of the last finished action, and that is what a
commit pushes. This one predates the 3D work and shipped in P2.

The two tools:

- **`tools/test-mesh.mjs`**, wired into `check-release.mjs` as section 5d. It
  checks every triangle's geometric normal against the vertex normals it was
  built from, and that every designable zone has a model surface to print on. A
  part wound the wrong way is not drawn wrong, it is not drawn, and nothing says
  so.
- **`tools/probe-3d.html`**, local only. Draws all six products side by side with
  a checkerboard and a word on them and reports how much of the frame each
  covers. Every geometry bug above was visible in one screenshot of it.

## Framing, and controls that follow the finger

The camera frames against the **upright cylinder** around the model, which is
exactly the bound a Y axis orbit cannot change, so turning a mug can never clip
its handle. Tilting does change the vertical extent, and the second term of the
distance is that projection, so a hard tilt eases the object away instead of
cropping it. Framing against the largest dimension instead made a cap, which is
twice as wide as it is tall, render at a third of its proper size.

The finger holds the object, not the camera, so both axes subtract. Both were
checked by measurement rather than by reasoning:

- dragging right 72px moved the printed text right by 110px;
- dragging down raised the camera, measured as the floor shadow's area going
  29218, then 43548, then 45372 across three drags.

The keyboard goes through the same `turn()` as the pointer, so the two cannot
drift apart. Under `prefers-reduced-motion` the opening turn is not there at
all, verified as zero `requestAnimationFrame` calls with the object drawn
finished in one frame. A lost GPU context falls back to the flat preview and the
customizer keeps working, verified by calling `WEBGL_lose_context` mid session.

## The rest of the pass

- The gift box builder uses the same engine, so the box the buyer turns is the
  box that arrives.
- The proof and the print file stay on the flat renderer, deliberately. What
  gets printed is flat, and a photograph of a mug is not a thing a press can
  output.
- The shop's twelve card thumbnails stay on the flat renderer too. Twelve WebGL
  contexts on one page is near the browser's limit and would cost more than it
  buys.
- Cart thumbnails come from whichever preview the buyer was actually looking at,
  and both now get a white ground first: JPEG carries no alpha and every
  thumbnail was being written onto black.
- `.cz-linkbtn` gets a 44px hit box out of padding, with the space given straight
  back as negative margin so nothing on screen moves. The two remaining small
  targets are links inside a sentence on the homepage, which the target size rule
  exempts and which would overlap their own neighbouring lines if padded.
- The shared element name moved from `#preview` to `.cz-canvas-wrap`. There are
  two canvases in that box now and only one is on screen at a time, and a view
  transition whose target is `display: none` does not run at all.

## v0.2.9. A stale empty cache beat the bundle

v0.2.8 went out and the live customizer still said "We could not open the
customizer just now", with `Data.usingBundle` reporting true. The bundle had
loaded and the recipe still could not be found.

Builds before the fallback existed cached whatever the database returned,
including an empty collection against an unseeded database. `Data.collection`
then had this in its catch:

    if (cached) return cached.data;
    return bundleCollection(name)...

A seven hour old `{at: ..., data: []}` is truthy, so it was served in preference
to a bundle that was sitting right there, and `Data.doc` correctly reported that
there is no products/mug. It would have hit every returning visitor who had
opened any earlier version, and nobody else, which is the worst shape a bug can
have: invisible in a fresh browser.

An empty list is never an answer now, whether it arrived from the database a
moment ago or from the cache seven hours ago. The poisoned entries age out on
their own rather than needing a migration. Reproduced by writing exactly what
v0.2.7 left behind into localStorage and confirming the screen recovers.

## v0.3.0. The off switch was wired backwards

A buyer designed a mug, approved the proof, typed out their name, phone and
address, pressed the button, and got this:

    api.giftylb.com/api/upload  net::ERR_NAME_NOT_RESOLVED
    We could not reach the order desk just now. Nothing has been charged.

Nothing was wrong with the worker, because there is no worker yet. The whole
point of `READY` in `js/checkout.js` is that a half configured site never gets
that far. It is computed correctly:

    var READY = !!(window.GIFTY_API && window.GIFTY_CONFIG && window.GIFTY_CONFIG.turnstileSiteKey);

and `turnstileSiteKey` is still empty, so `READY` was false and the "Ordering is
not switched on yet" notice was on screen the whole time. The gate in `validate`
then said:

    && (!READY || !!turnstileToken)

which reads as "a token is only needed when ordering is on". It is the sensible
looking sentence and it is the wrong one. With ordering off it collapses to
`true`, so the one condition meant to hold the button shut was the one condition
that could never fail, and the button went live the moment the address field was
long enough. The buyer's proof and print file were then uploaded at a hostname
that does not resolve, and the catch around the order told them to try again
later, which they cannot, because the thing they are waiting for is a deploy.

The fix is `&& READY && !!turnstileToken`. A missing token now blocks for the
same reason a missing address does.

The other half of the bug was the button itself. It never comes alive in this
state, and a dead button that still says "Place the order" reads as broken
rather than as switched off, so the not ready branch of `armTurnstile` now
labels it "Ordering is not switched on yet", the same words as the notice above
it. It wraps to two lines at 375px and does not overflow.

Verified in a 375px iframe against the real page: with the proof approved and
every field filled, `place.disabled` is still true, clicking it does nothing,
and the network log records zero requests to `giftylb.com`. Nine routes swept at
375px afterwards: no horizontal scroll, no console errors. `check-release.mjs`
exits 0, `test-parity.mjs` 16143 agreed 0 disagreed, `test-mesh.mjs` every part
wound outward.

This does not switch ordering on. It stops the site from pretending it is on.
Ordering needs the worker deployed, `turnstileSiteKey` and `GIFTY_API` filled in,
and `giftylb.com` resolving, all of which are still on the waiting list above.

## v0.3.1. There is no domain, so stop building on one

`giftylb.com` has never been registered. Every absolute URL in the repo named it
anyway, which is how the checkout ended up posting a buyer's proof at
`api.giftylb.com` and how the homepage carried a `noindex` waiting for a launch
that has no date. The site's real address is the Pages URL. This release says so
everywhere instead of treating it as temporary.

The worker had `pattern = "api.giftylb.com"` with `custom_domain = true`, which
cannot deploy at all without the domain being on Cloudflare first. It is
`workers_dev = true` now, so the worker gets its own permanent
`gifty-api.<subdomain>.workers.dev` address, free, and the browser reaches it
cross origin from `chaos-961.github.io`, which is the only entry left in
`ALLOWED_ORIGINS`.

`FROM_EMAIL` was `orders@giftylb.com`. Resend will not send from a domain it has
not verified and verifying a domain needs a domain, so every confirmation would
have failed. It is `onboarding@resend.dev`, Resend's own shared sender, which
needs no verification and works on the free plan.

`GIFTY_API` is an empty string rather than a guess. `READY` is false while it is
empty, so the checkout shows the proof and says ordering is not on yet, which is
true, instead of failing at DNS, which was a lie about why.

The rest is honesty about the address:

- `index.html` and `shop.html` swap `noindex` for a real `canonical` at the
  Pages URL. `og:url`, `og:image`, `twitter:image`, the `LocalBusiness` block,
  `sitemap.xml` and `robots.txt` all name it too.
- `js/shop.js` no longer writes the origin down for its `Product` JSON-LD. It
  reads `location.origin + location.pathname` minus the filename, which is right
  under a path on Pages, right at a bare host on a domain later, and cannot
  drift from the page the crawler is actually standing on.
- `CNAME` stays out of the deploy allowlist, unchanged.

375px on eight routes: no horizontal scroll, no console errors. Checkout with
every field filled and the proof approved still refuses to arm the button, with
zero requests leaving the page. `check-release.mjs` exits 0.

## v0.3.2. There is no server

Asked for Firebase and nothing else, so the Cloudflare Worker, Turnstile, Resend
and ImgBB are deleted rather than parked. The browser writes the order itself and
`firestore.rules` is now the only thing between a buyer and the database.

The Worker held three things a browser cannot be trusted with: the exact price,
an image host key, and the one identity allowed to write an order. Two of those
went away with the vendors. The third did not, and the honest accounting is
written at the top of the rules file rather than discovered later:

- Rules cannot loop, so they cannot evaluate a product's pricing clauses against
  a configuration. They **bound** each line between `basePrice` and
  `basePrice + maxExtras`, read live from `products/{id}`. Nobody pays a cent for
  a mug. A buyer can underpay for extras, and on cash on delivery, where no card
  is charged and the shop confirms every order by hand, that is a discrepancy
  somebody reads rather than money taken.
- There is no bot protection at all now. A script can create orders until the
  daily write quota is gone, and when it is, catalogue reads start failing too.
- A `get` on an order returns the whole document, phone and address included, to
  anyone who guesses a five digit number.

The last two are fine for testing and are not fine at launch. `orders` allows
`get` and refuses `list`, so guessing one order is at least a different thing
from downloading all of them.

### The images ride inside the database

Cloud Storage is not on this plan, so the proof, the print file and the buyer's
own photo are base64 and split across an `assets` subcollection under the order,
620,000 characters a chunk, which sits under the 1,048,576 byte document ceiling
once the envelope is counted. This is exactly the pattern the agency site's
careers form has been running on for its CVs, copied deliberately rather than
reinvented, including the two things that pattern already knew:

- **The order goes first and the chunks after.** A failure part way through then
  leaves an order the admin can see, with the buyer's name and number intact and
  an image it reports as incomplete. Written the other way round it would leave
  chunks under an order that does not exist, which nothing can list, show or
  delete, sitting in the quota forever.
- **A subcollection does not inherit its parent's rules in `rules_version = 2`.**
  Without its own `match` block every chunk is denied and the order lands with no
  pictures.

Five chunks a commit keeps every request under the 10 MiB cap on a write
*request*, which is a different ceiling from the one on a document and the one
people forget.

Nothing stores a bitmap that can be drawn again: the admin re-renders from the
saved design. Only the buyer's photograph is irreplaceable, so only it is kept
at print size.

### A shipped bug: the catalogue could never be seeded

Seeding the emulator to test any of this threw immediately:

    FAILED: $.model.parts[0].profile[0] is an array inside an array

Firestore cannot nest an array in an array. The repo already knew that, for
quads, and handled it in two places that have to agree: `flattenQuads` in the
seeder going out, `Recipe.normalize` coming back. v0.2.8 then added `model`
blocks whose lathe `profile` and tube `path` are both lists of points, and told
neither function. `tools/seed-firestore.mjs` has thrown on the first product it
reached ever since, which means the live catalogue could not be written at all,
and nobody saw it because seeding had not been run since.

Both halves handle all three shapes now. More usefully, `check-release.mjs`
section 5e walks every recipe and fails on any nested array nobody has handled,
naming its path, so the next one is caught at release rather than at a seed.
Negative tested: adding `printZones[].fakeOutline` fails the release with that
exact path and removing it passes again.

### Fixed on the way

The tracking page read `order.promisedDate` and `order.zoneName` off the top
level, because that is the shape the Worker used to hand back. The real document
keeps them under `delivery`, so the first live order tracked as "Arriving
undefined in undefined".

### Proven

`tools/test-order.mjs` is rewritten with no Worker and no `worker/src` import,
going over the wire exactly as `js/order.js` does, unauthenticated:

    27 passed, 0 failed

covering the happy path, chunk acceptance and exact reassembly, an oversized
chunk, an unexpected field, an overwrite attempt, seven money tampering attempts,
eight shape refusals, get allowed and list refused for a shopper, list allowed
for the shop, and a full six line cart inside the 1000 expression budget.
`test-parity.mjs`, `dev-worker.mjs` and `probe-rule-cost.mjs` are deleted: the
first because there is no second price implementation left to drift from, the
last because its measurement moved into `test-order.mjs`.

Two real browser orders at 375px against the emulator. `GFT-12912`, text only:
`createdAt` a real server timestamp, proof 61,163 characters in one chunk, print
file 68,438 in one. `GFT-99504`, with a photo: the photo needed **3 chunks**,
1,380,859 characters of base64, and came back complete with no holes. Tracking
shows "Arriving Sat 5 Sept in Beirut area." with the proof reassembled at
1200x933, and neither the address nor the phone appears on the page.

The recipe round trip out of the seeded database restores `profile[0]` to
`[0,-1]` and `path[0]` to `[0.79,0.62]`, with `Data.usingBundle` false, so the
database really is being read and the geometry really is being rebuilt.

`check-release.mjs` exits 0. `test-mesh.mjs`: every part wound outward. Eight
routes at 375px: no horizontal scroll, no console errors.

---

## v0.3.3. It stopped looking like a template

Authorised in session 2026-09-01: polish the whole front end, the admin
included. Design, motion, background, scroll behaviour, and every product
picture on the site.

The engineering was already sound and the surface was generic: two flat whites
alternating, outline icons in mint squares, two shadow levels, one fade up, and
a renderer that drew ceramic as grey plastic. Four things fixed that.

### 1. The renderer got a room

`js/engine/scene.js` lit with three directional lights and a Phong exponent,
which is why every product came out of it looking like moulded plastic. It now
has:

- **A procedural studio.** `env(dir, rough)` is a photographer's room: soft
  ceiling, warm floor, a big key softbox up, left and in front, a cooler fill
  opposite it, a brightness gradient across the walls, and a dark band at the
  back wall just under the horizon. Diffuse samples it along the normal,
  specular along the reflection vector, and roughness widens the sources the way
  a real blurred reflection does.
  **The dark band is the single most load bearing line in the file.** A glossy
  edge with nothing dark to reflect has no edge at all, which is exactly why the
  first white mug had no silhouette against a white page.
- **GGX instead of Phong.** Trowbridge-Reitz distribution, Smith geometry,
  Schlick Fresnel, a dielectric F0 of 0.045 and albedo F0 for metal. Phong has
  none of those three terms and that is why it reads as plastic.
- **A clear coat.** A mug is rough ceramic under a hard glaze and one roughness
  cannot be both, so `coat` layers a second always sharp reflection on top.
- **A floor.** Every part is drawn a second time through the plane it stands on,
  faded by how high the part sits, blended under the contact shadow. Two things
  have to change for it and forgetting either one is the whole effect: the
  **winding**, because a mirror swaps handedness and the default cull then
  throws away exactly the surface that should be visible, and the **alpha**,
  because a floor is not a mirror and a reflection reaching the top of the
  object reads as a second object standing upside down.
- **Contact.** Ambient occlusion over the bottom third of the object's height
  plus a downward facing term, and a contact shadow with two lobes rather than
  one: a tight dark core where it touches and a wide soft skirt for what the
  room bounces. One lobe always reads as an airbrushed smudge.
- **ACES tone mapping**, which rolls highlights off into colour instead of into
  flat white, and a **dither**.

**Two measured bugs found while tuning it, both from a first version that looked
plausible and was wrong:**

- **The dither was in linear space.** Half a code value before the gamma is half
  of the DARKEST eight bit value after it, so a black mug came out covered in
  visible grain and a white one had none. Moving it after `toSrgb` fixed it. The
  fix is one line and the symptom looked like a texture bug.
- **The generic attribute arrays.** The contact shadow's only attribute is
  generic index 0, which is also `aPos`, and disabling it after that pass turned
  `aPos` off for everything drawn afterwards. Each mesh pass switches its own
  three on now rather than trusting what the previous pass left behind.

**Exposure had to be measured, not reasoned about.** The first balance put a
scanline across a white mug's belly at 188 down to 76, which is a grey mug. Two
numbers moved it to **239 down to 165**, which is a white one: the ambient
weight, the direct weight, and one structural fix, which was that the dark back
wall was being applied to the diffuse term as well and dropping every shadow
side into the eighties.

### 2. Every product is a photograph now

- **The homepage grid** was six line drawings in six mint squares. It is six
  real renders carrying real photographs, drawn by `js/showcase.js` after load,
  one throwaway WebGL context at a time. Six live contexts is most of a
  browser's budget for the whole tab and the seventh silently kills the first.
- **The hero** is the real object and it is **turnable**. It spins into view,
  the photograph settles onto it, then the name types on. Dragging it is the
  shortest possible demonstration of the sentence the whole site is built on.
- **The shop cards** were the flat print rendering. They are the object now, one
  WebGL context per PRODUCT rather than per card, so twelve cards cost six
  contexts and two cards of the same product are two updates of one scene. The
  flat render is still the fallback and is still what the proof and the print
  file come from.
- **The share card** is a render at eighteen degrees rather than the recipe's
  opening angle, which needed a five line `turnTo` on the scene API. The recipe
  angle is chosen to show a buyer that a mug HAS a handle; a share card is
  chosen to show them the photograph on it.

**A bug that would have shipped invisibly:** `base.css` caps every canvas at
`max-inline-size: 100%`, which clamped the off screen render canvas to the
phone's viewport and composed every product into a **360 by 560** frame it was
never framed for. Both off screen canvases now set `max-inline-size: none`.

### 3. Real photographs

`assets/hero/photo.svg` was a hand drawn vector sunset. It is gone. Four real
photographs live in `assets/samples/` and are printed onto the products by the
homepage, the hero and the share card. Provenance and licence in
`docs/SAMPLE-PHOTOS.txt`: Unsplash, by way of picsum.photos, free for commercial
use. They are demonstrations of what a print looks like, not photographs of our
own work, and nothing on the site claims otherwise.

### 4. The surface

- **An atmosphere.** `css/atmosphere.css` is one fixed layer behind everything:
  two sheets of soft light and a grain over them that stops forty rem gradients
  banding on an eight bit panel. **Nothing loops.** The field is linked to the
  SCROLL, not to a clock, so it is perfectly still when the reader is still,
  costs nothing at idle, and reads as depth rather than as a screensaver.
  It never sits under small type: sections carrying captions keep an opaque
  ground, so every ratio in the contrast table is still the ratio on screen.
- **Four elevation levels**, each a stack of a tight contact term and a wide
  ambient one, because a single blur always looks like a sticker. Plus `--edge`,
  one inset hairline, which is the difference between a rectangle of colour and
  something with a thickness.
- **A motion layer**, `js/motion.js`: word by word headline reveal, pointer tilt
  with a moving specular on cards, magnetic call to action buttons, press
  ripples. All additive, all removed under reduced motion, none of it hiding
  anything.
  The magnet writes `--mx` and `--my` rather than an inline transform, because
  an inline transform is the highest specificity there is and it silently
  deleted the press scale on the one button that most needs to confirm a tap.
- **Reveal variants.** Four ways in rather than one fourteen pixel nudge, with a
  stagger step in the tokens, because using the same entrance for a card grid, a
  headline and a wide band is what makes a page feel templated even when every
  other decision on it was right.
- **A scroll progress line**, a header shade that deepens with the scroll, a
  hero parallax, a cart badge that jumps when the number really changed and
  never on first paint, a customizer panel that slides when the tab changes, a
  proof tick that draws itself once.
- **Drag inertia** on every 3D preview. Let go while still moving and the object
  keeps turning and slows down. The release velocity is a running average, not
  the last sample, because the last sample as a finger lifts is usually zero and
  the flick died on release every time.
- **A real footer** on every page, three columns, every link a 44px target.
- **The admin** got the same tokens, a glass bar, a sign in dot that is the only
  thing on the screen reporting whether the account is really signed in, status
  pills with a leading dot so six pastels are not six greys down a long list,
  and a gate that shakes once on a wrong password. Its stylesheets had been
  pinned at `?v=0.2.7` since v0.2.7.

### Proven, with pasted output

- `check-release.mjs` exits **0**.
- `test-mesh.mjs`: **six products, every part wound outward**, after the
  material rewrite and after resampling the tube paths.
- **All nine routes at 375px**, measured inside a real 375 wide same origin
  frame: no horizontal scroll, no spill, no console errors, and the only tap
  target under 44px anywhere is an inline prose link, which the standing rule
  allows.
- **The flick, measured rather than reasoned about**: a synthetic drag changed
  **21110** sampled pixels, and after the pointer was released the object kept
  turning for another **1710**.
- **A white mug's belly** reads **239 at the key edge down to 165 in shadow**,
  from 188 down to 76 before the exposure pass.
- The share card is **69856 bytes** and is a render of the real object with a
  real photograph on it.

---

## v0.3.4. The two launch blockers are closed

They were written at the top of `firestore.rules` since v0.3.2 and they were the
only two things standing between this and taking real money from strangers.

### Bot protection: an order costs an identity

There was none. Turnstile went with the Worker and an unauthenticated POST in a
loop could drain the daily write quota, which takes ordering down and catalogue
reads with it.

Every write to an order, in every collection under it, now needs a Firebase
identity. The checkout mints an **anonymous account** for itself at the moment
of ordering, uses it once and throws it away: no password, no email, nothing for
the buyer to manage or lose, and they never see it happen.

That is not a wall and the rules say so out loud rather than pretending. What it
actually buys:

- a plain curl loop no longer works at all,
- every attempt passes through Firebase Auth, so Google's own per project and
  per address quotas and abuse detection are in front of it rather than nothing,
- **one identity is worth exactly one order.** `throttle/{uid}` is written in
  the same atomic commit as the order, and the order rule refuses to write when
  it already exists. A stolen or replayed token buys one order and no more,
- every order carries the uid that placed it, so abuse is visible in the admin.

The throttle needed one thing to be true and it is worth writing down: **`exists()`
inside a commit reads the state BEFORE the commit.** That is why the order and
the document that spends its identity can be written together.

A real buyer never meets the throttle, because the checkout mints a fresh
identity every time. Proven in a browser: two orders placed one after another
from one page, two different uids, one order each.

### Privacy: the order document is split in three

A `get` used to return the whole document, phone and address included, to
anyone who guessed a five digit number.

    orders/{n}                  what a tracking link may show. Status, dates,
                                product names, quantities, money, the zone.
    orders/{n}/private/details  who and where. Written once by the buyer, read
                                only by the shop, never updatable.
    orders/{n}/assets/{part}    the proof, and ONLY the proof. The id pattern is
                                enforced in the rule, so nothing else can be
                                smuggled into the collection a stranger can read.
    orders/{n}/print/{part}     the print file and the buyer's own photograph at
                                full size. Shop only, both ways.

Reads take an identity too now, so walking the number space costs an account per
attempt rather than a curl. `list` stays shop only. And the order number went
from five digits to **six**, which takes the space from 90,000 to 900,000.

What a guessed number still shows: that an order exists, what was on it, what it
cost, and the proof image. That is the tracking page's whole job and it cannot
be hidden from somebody holding the number.

### What it cost elsewhere

- **`js/order.js`** owns the split, in one function, because getting it wrong is
  a privacy bug and it should be wrong in one place or none. It commits the
  order, the private details and the throttle as ONE atomic write: an order that
  lands without its address is an order the shop cannot deliver.
- **The admin** joins the private documents back on with a single collection
  group query, so three hundred orders is one extra request rather than three
  hundred. Everything downstream still reads `order.buyer.name` the way it did.
  Nothing writes them back: the status change is a PATCH with an explicit field
  mask naming `status` and `statusHistory`, and that was checked rather than
  assumed.
- **The emulator grew an Auth emulator**, and `tools/devserver.py` injects
  `GIFTY_AUTH_BASE` beside the Firestore override, so the whole path including
  sign in can be exercised locally without touching the live project.
- **A sign in that never happened no longer reads as a price problem.** The
  checkout had one message for a refused write, and a refusal caused by auth
  being switched off would have said "something no longer matches our prices",
  which is the v0.3.0 mistake wearing a different hat.

### Proven, with pasted output

- **`test-order.mjs`: 49 passed, 0 failed**, up from 27, against the emulator
  and the real rules. Including: an order with no identity is refused, one
  identity is worth one order, an identity cannot spend somebody else's
  throttle, an order cannot claim to have been placed by another identity, a
  shopper cannot read who and where, a shopper cannot read the print file or the
  photograph, nothing but a proof can be written into the public collection, and
  a shopper cannot gather the private details.
- **The expression budget still holds: the rule evaluates a full six line
  cart.** Splitting the buyer out took `buyerOk`, `paymentOk` and the address
  check off the order rule, and that is what paid for the throttle lookup.
- **Two real browser orders against the emulator**, `GFT-402133` and
  `GFT-490655`, six digits, two identities, one order each. The public documents
  carry `createdAt, delivery, items, orderNumber, status, statusHistory, totals,
  uid` and nothing else, and `delivery` carries `fee, promisedDate, zone,
  zoneName` and no address.
- **Unauthenticated, everything is 403**: the order, its proof, its private
  details, its print file, the throttle and the orders collection.
- **The tracking page** shows `GFT-402133` with its status timeline and its
  proof reassembled, and a scan of the rendered page for the buyer's name, phone,
  address and note found none of them.
- **The admin** lists eleven orders with buyer names joined from one collection
  group query, and opening one shows the address, the note and both images. After
  moving that order to `confirmed` the public document still carried no PII.

### The setting that was not the setting

Turning the Anonymous provider on changed nothing. `accounts:signUp` kept
answering `ADMIN_ONLY_OPERATION` while the config read back
`anonymous: {enabled: true}`, through two minutes of retries.

The cause was `client.permissions.disabledUserSignup`, the project level
"prevent users from signing up" switch, which was on. **While it is set, sign up
is refused for every provider, and the provider's own flag says nothing about
it.** Worth knowing before spending an afternoon on the wrong one.

Turning it off also allows email and password account creation. Under these
rules that buys nothing: `isShop()` names one uid and every other rule that cares
about identity cares only that there IS one, so a new account can place one order
and do nothing else. The trade was worth taking, and the useful half of it was
`quota.signUpQuotaConfig`, a ceiling of 500 anonymous sign ups an hour applied by
Google before a request ever reaches the rules. That is a real rate limit on
precisely the thing blocker 1 is about.

### Proven on production

Fifteen checks over the wire against the live project, placing a real order
exactly the way `js/order.js` places one, then reading it back as a second
anonymous identity: the order opens and the proof reads, and who and where, the
print file, the orders list and the throttle collection are all refused.
Unauthenticated, every order path is 403 and `products/mug` is still 200.

Then the real thing: `GFT-231009`, placed from a browser on
`chaos-961.github.io`, followed on the tracking page with its status, its date
and its proof, and a scan of the rendered page for the buyer's name, phone and
address found none of them.

Both test orders were deleted, document, subcollections and throttle document,
and `orders` and `throttle` were both confirmed empty afterwards.


## v0.3.5, 2026-09-04. Better shapes, more to change, a phone menu, and one bad proof

Authorised in session 2026-09-04 as one polish release: models, customization,
mobile UI, scroll animation, bugs, push. Then the user reported that the admin
was showing a mug "not correctly", which turned out to be the most important
line in the release.

### The proof was wrong, and so was the print file

The admin was fine. The proof it showed for order `GFT-674332` was a white mug
with the buyer's photograph as a thin strip in the top left of the wrap and the
name where it should be. The strip was the bug. The customizer works out a
photo's zoom, `k`, against the upload's own pixel size, and the snapshot saves
that `k` together with `natW` and `natH`. Across a page the upload is gone and
`State.hydrate` reloads the 1800px autosave copy, then set `natW` and `natH`
from that copy while keeping the old `k`. A 4000px phone photo therefore drew
at 45% of the size the buyer chose, in one corner, on the checkout proof and on
the print file both. Any photo under 1800px on its longest edge was unaffected,
which is why every test order and every sample photograph passed.

The fix is one line: `k` is rescaled by the ratio of the saved width to the
copy's width, so the drawn size is exactly what was chosen and the resolution
gate now reports the copy, which is what will really print. Proven with a 3200
by 2400 canvas photo at zoom 160: drawn width 1385.6 before and 1385.6 after a
reload with the cache cleared, and the centre and corner pixels of the two
renders agree to within one level.

`GFT-674332` was placed with the old code. Its proof and its print file are
wrong and the buyer's full photograph is in `orders/GFT-674332/print`, so it
can be remade by hand or re-placed once this is live.

### The models, as data

`js/engine/mesh.js` gained `rotX` and `rotZ` next to `rotY`, applied scale,
then X, then Z, then Y, then move, with the normals taking the same rotations.
That is the whole of the engine change. With it:

- **bottle**: a lipped lid with a collar groove and a dome, a carry loop as a
  tube in the lid's metal, a softer shoulder, a chamfered base, a band with a
  rounded section.
- **cap**: a lower crown that stops looking like a bowler, a bill that subtends
  130 degrees instead of 152 and curls down harder.
- **photo block**: the pane leans back three degrees into a dark slot cut into
  the base, and its bevel is a polished chamfer rather than a soft round.
- **gift box**: the ribbon is ten thin strips lying on the lid and the sides
  rather than two slabs passing through the box, with a knot, two tails on the
  lid, and the card leaning against the front at sixteen degrees with its foot
  on the floor.

`test-mesh.mjs`: six products, every part wound outward, 18 parts on the box.
Rendered through `tools/probe-3d.html` against the local bundle (the emulator
port refused, so the storefront fell back to `data/catalogue.json`, which is
the way to see local recipe edits without seeding).

### More to change

Text: alignment, tracking, all caps, an outline in a contrast colour chosen
from the text colour, a drop shadow, and a curve of up to sixty degrees each
way, drawn one glyph at a time along an arc. Typed line breaks are honoured
where the recipe allows more than one line, and the words box is a textarea
that grows a row per allowed line. Photo: a quarter turn, a mirror, six looks
(as it is, black and white, sepia, warm, cool, pop) as a cached pass over the
pixels, and four windows (full, soft corners, round, heart). Zone: a background
colour on the mug wrap and the tote, priced as an extra and bounded by
`maxExtras` like every other one.

Every new field has a default in `Design.TEXT_DEFAULTS` and
`Design.PHOTO_DEFAULTS`, rides through `State.snapshot` and `hydrate`, is
copied by `fromTemplate`, and is range checked by `check-release.mjs` 5c.
Proven in headless Chrome at 375px: heart-shaped sepia rotated photo, butter
fill, two priced lines, curved right-aligned caps with an outline, price
breakdown `Mug $12, Photo print $3, Text line x2 $3, Background colour $1.50`,
undo walking back through every one, and the snapshot carrying all of it.

### The front end

- A phone menu, `js/nav.js` and a sheet under the header. Before this a phone
  could not reach "How it works" or "Delivery" from any page but the homepage.
- A back to top button after a screen and a half, parked below the edge by a
  transform rather than an opacity so the rule that hides it cannot strand it.
- `--header-h`, `scroll-padding-block-start` on the root, and the three sticky
  sidebars reading the token instead of 76 and 78.
- The hover tilt never worked: the CSS was written for a `.tilt` class nothing
  set. And once the selector matched, the tile's own reveal animation, a
  `transform` with fill `both`, kept overriding it. The lean now lives on the
  individual `rotate` and `translate` properties, which compose with an
  animated transform. Measured: `rotate: 0.7 0.8 0.001 3.4deg` on hover,
  `0deg` after leave.
- On a phone the hero's object comes right after the headline.
- The steps rail fills as each step comes into view, a scale on the pseudo
  element under a view() timeline.
- A questions section with six real answers and `FAQPage` structured data.
- Checkout: the fields are a form, each required box says what it needs once
  it has been left, and pressing the button with something missing focuses the
  first missing box instead of sitting greyed out with no explanation.
- The cart has a total bar stuck to the bottom of a phone screen.
- "From $12" stamped on each homepage tile by the showcase from the recipe it
  drew, so it is the catalogue's number and not a second price list.
- The reveal observer moved from `js/main.js` to `js/nav.js`, so `.reveal` is
  safe on every page.

Nine routes at 375px in real headless Chrome: no console errors, no horizontal
overflow, nothing left at opacity 0.

## v0.3.6, 2026-09-04. Photoshop for a mug, a real cap, the moon, and no more box

Authorised in session 2026-09-04 as one release: "more customizations,
better controls, revamp the customization system; polish the main pages, add
scrolling animations; fix all of the models; remove the gift option; bring the
moon template in beside the cap and the cup."

**The gift box is gone.** `box.html`, `js/box.js`, `js/bundle.js`,
`css/box.css`, the `gift-box` recipe and its art, the `giftBox` settings key,
the box cards on the shop and the cart, the packing sheet's box column in the
admin. `firestore.rules` is untouched: it reads `totals.discount`
unconditionally, so the checkout still writes `discount: 0` and the bound
clause passes with nothing to bound. `products/gift-box` has to be deleted from
production by hand, the seeder only ever upserts. An old cart still holding a
box line drops it on load.

**The engine grew two things and fixed one.** A partial lathe closes its two
ends (ear clipped from the profile polygon, wound to face out), `droop` sags a
sweep toward its ends so a bill curves instead of sitting on a saucer, and box
uv is measured in distance across the face rather than in samples, which is
why the tote's "63% panel" was really 94% and bled onto both rounded edges.

**Every model was rebuilt** in `tools/build-models.mjs`, which writes the
`model` blocks: seam paths resampled along the crown profile, a handle that
enters the wall square on, a frame that leans as one piece. The cap is a five
panel structured cap now: the front panel is a 92 degree sweep of the crown
profile carrying the print, the rest of the crown is the other 268, five seam
tubes sit on the panel edges, and the bill is a capped 98 degree slab with
`droop 0.72`. The bottle has a shoulder, a threaded neck, a domed lid with a
loop, a satin coat (`gloss 0.9 rough 0.18 metal 0.15 coat 0.45`), and its
default colour is deep teal: measured against six material variants, a black
bottle swallowed its own engraving in every one and teal and white read
cleanly. The mug has a foot ring, a rolled rim, a tapered handle and a print
rectangle with the zone's real aspect (it was 13.6% out). The tote's print is
a centred panel with straps on the outside of the cloth and stitch patches.
The etch pass is stronger so an engraved caption reads on oak and on teal.

**The customizer is a control table.** Every slider is a row in
`js/customize.js` naming the state key, its range and how to say its value;
one builder makes it, wires touch and commit, syncs it after undo and resets
it on a double tap. New on text: across, tilt, line spacing, weight, opacity,
outline width, a second colour to fade into, and a pill, box or underline
behind the words. New on a photo: free tilt, opacity, brightness, contrast,
colour, soft edge, border, vignette, four more shapes, and a photo may now be
smaller than its zone (a round picture on a coloured mug) down to a quarter of
cover. New on a zone: a second fill for a gradient and a pattern (dots,
stripes, grid, rays). A free colour picker sits at the end of every text and
fill palette; product colours stay on the palette because those are the
coats the workshop stocks. The Design view takes a drag on the words as well
as the photo, a pinch or a wheel zooms, and there is a redo button.
`State.snapshot` copies every scalar on a photo rather than a list, so a new
option cannot be lost on undo by being forgotten there. `Design.textBox`
gives the customizer the same rectangle the renderer drew, for hit testing.

**The moon.** `C:\Development\Websites\Templates\moon` was a three.js page.
It is ported with no library: `js/lunar.js` is the Meeus ephemeris verbatim
(`tools/test-lunar.mjs`, 30 passed), `js/engine/moon.js` raycasts a sphere in
one fragment shader against the 1k NASA colour and normal maps under
`assets/moon/`, with a software path for stills where WebGL is missing.
`moon.html` is the experience, restyled to the site: date and time, the sky
as one dark card, six facts, every full moon since on a slider with play, and
a button into the customizer with the date in the URL. The product is
`moon-print`: a framed 30 by 40 print with a `poster` zone that accepts
`moon` and text, a `caption` strip, six fills, and one colourable frame. The
moon is a photo record that carries a date instead of pixels; `State.hydrate`
draws it again on any page through `State.moon()`, which loads the two files
on first use, so no other page pays for them. Templates may name a date
(check-release 5c allows a photo that has `moon` and no `saveSrc`), the shop
card hydrates before it paints, the homepage showcase takes `moon:`.

**Motion.** Scroll driven, rest state finished: the eyebrow rule draws itself
in, a step number pops as its step arrives, an object settles onto its tile,
the footer columns rise, the FAQ rows rise, and the hero mug turns with the
scroll once its opening turn has landed.

Not done and said so: `tools/test-order.mjs` was not run this release (the
rules and `js/order.js` are unchanged, the emulator was not started).
