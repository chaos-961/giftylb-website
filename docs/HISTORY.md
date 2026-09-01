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
