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
