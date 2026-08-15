# primex A prime number explorer

* Typescript, using Google coding style.
* npm, vite
* Compile to a single self-contained index.html for deployment

Tasks
[x] App stub, compiles index.html
[x] Color scheme is basically black on white. Thin black border around the square image. Non-prime squares are white, primes are black.
[x] Prime number generator.
[x] Image creator, params are scale, origin. Image height=width=2^scale. Origin is the lower left quarter image.
[x] Default view scale=9 (512x512), origin=2
[x] Navigation.

# v2: Continuous navigation

Replace the discrete tap-to-zoom/pan navigation with continuous swipe-driven
pan and zoom (with inertia), backed by a tile cache so panning/zooming don't
require re-running primality tests on every frame.

## Camera model

Two axes, each an exact bigint/int anchor plus a small bounded float for
sub-cell animation — never a single float carrying unbounded-depth precision.

```
origin: bigint            // x anchor: an integer cell at generation bottomGen
frac: number ∈ [0, 1)     // x: continuous offset within origin's own cell

bottomGen: number         // y anchor: exact integer = origin's bit-length − 1
zoomFrac: number ∈ [0, 1) // y: continuous offset toward bottomGen ± 1

visibleRows: number       // fixed constant (e.g. 9): viewport height in
                           // generations, decoupled from zoom/pan entirely
```

`bottomGen` is a plain zoom-depth counter, tracked as its own state rather
than derived from `origin`'s bit length. It's tempting to derive it (bit
length is free to compute from a bigint), but a pure pan step can cross a
power-of-2 boundary (origin 3 -> 4) without that being a zoom event — if
`bottomGen` were re-derived after every pan, the rendered scale would pop
on a sideways swipe with no zoom involved. Only `zoomBy` changes it.

Dropping the old "origin must be even / represents a sibling pair"
invariant: under continuous camera motion the anchor can land on any
integer, not just tap-selected pairs. Children of `origin` are simply
`origin*2` and `origin*2+1`.

### Rebasing (the core mechanic — both axes funnel through `origin`)

- **Pan overflow** (`frac` leaves `[0,1)`): `origin ± 1`, wrap `frac` into
  range. Same-generation neighbor shift.
- **Zoom-in overflow** (`zoomFrac >= 1`):
  `origin = origin*2 + (frac < 0.5 ? 0 : 1)`, `bottomGen += 1`,
  `zoomFrac -= 1`, `frac = frac*2 - (frac < 0.5 ? 0 : 1)`.
- **Zoom-out overflow** (`zoomFrac < 0`):
  `origin = origin >> 1n`, `bottomGen -= 1`, `zoomFrac += 1`,
  `frac = (frac + (origin_old odd ? 1 : 0)) / 2`.
- Clamp at the root: `origin` cannot go below 2, `bottomGen` cannot go
  below 1.

Rendering always samples `visibleRows` generations starting at `bottomGen`
using ordinary bigint primality tests (unchanged from v1), then applies a
uniform `2^zoomFrac` scale so in-between frames look like smooth zoom rather
than discrete jumps.

## Tile cache

- A tile is a fixed-size offscreen render (reusing today's row-layout math)
  keyed by `(generation, tileIndex)`, where `tileIndex` comes from the same
  `floor(u * 2^generation)` math as the camera rebasing — i.e. tile keys are
  the standard slippy-map `(z, x)` scheme, valid regardless of where the
  camera currently sits.
- Cache in a `Map`, rendered lazily and kept as `ImageBitmap`/offscreen
  canvas; each frame, blit whichever cached tiles intersect the viewport via
  `drawImage` with the current pan/zoom transform.
- Missing tiles render async (no primality work on the main interaction
  thread's critical path); show the nearest coarser cached tile scaled up
  as a placeholder until the sharp tile is ready.
- No Web Worker for now — tile caching should absorb most redundant
  primality computation. Revisit only if profiling shows jank.

## Interaction

- Pointer drag updates `frac` (and/or `zoomFrac` for pinch/wheel), tracking
  velocity.
- On release, keep integrating the last velocity with exponential decay
  each animation frame until it's ~0, applying the same rebase rules as
  live dragging.
- Clamp so you can't pan/zoom out past the root.

## Implementation steps (staged — validate feel before optimizing)

[x] Camera module (`camera.ts`): state + rebase transitions above, with
    unit-style sanity checks (rebase round-trips, clamping at root).
[x] Generalize the renderer to draw from continuous camera state; replace
    click-quadrant nav with drag (pan) + wheel/trackpad-pinch/touch-pinch
    (zoom) wired to the camera module. (Ended up caching a single
    (origin, bottomGen) buffer with a 1-cell pan margin rather than a
    truly bare re-render per frame — cheap, and a natural stepping stone
    to the full tile cache.) Two follow-up fixes after phone testing:
    `touch-action: none` on the canvas (it was only `manipulation` on the
    wrapper, so the browser's own scroll/pinch was stealing the gesture
    before our pointer handlers saw it), and two-pointer pinch tracking
    (was wheel-only, so touch pinch did nothing). Known limitation: pinch
    zoom still visually anchors to a fixed corner (whichever child the
    camera is about to descend into), not to wherever your fingers are —
    revisit if it feels wrong in practice.
[x] Add inertia on top of step 2's interaction, plus real rubber-band
    overshoot at the root/min-zoom boundary.

    **Inertia**: pan/zoom velocity is an exponential moving average (alpha
    0.35) of applied-delta-per-ms, updated on every pointermove (drag or
    pinch alike). A single `requestAnimationFrame` loop runs continuously
    from startup rather than being started/stopped per gesture: it applies
    decaying velocity (`** frames`, normalized to ~60fps regardless of
    actual frame timing) only while `activePointers.size === 0`, so a live
    drag's own pointermove handler (full responsiveness, no EMA lag) and
    the inertia tail never fight over the same frame. A new pointerdown
    zeroes velocity immediately -- touching the screen always kills a
    fling, like a real touchscreen, rather than waiting for the loop to
    notice `activePointers` became nonzero.

    **Rubber-band overscroll**: stayed a pure render-time visual, layered
    on an *unchanged* hard-clamped camera -- deliberately not the "let
    frac go negative" design floated earlier, which would have needed a
    left buffer margin and made the render's crop math boundary-aware.
    Instead `overscrollXPixels`/`overscrollZoomOut` grow from whatever
    `dampPanDelta`/`dampZoomDelta` *absorbed* (`raw - damped`), via
    diminishing-returns growth (`pullOverscroll`: full sensitivity near 0,
    asymptotic toward a cap, e.g. 80px / 0.35 generations) so repeated
    pushes can't blow past the cap. The renderer takes them as an extra
    screen-space translate (pan) and scale reduction (zoom), always
    painting an explicit white fill first (not `clearRect`) since
    revealing past the buffer's edge needs to read as "nothing there,"
    not a transparency bug. Decay (`0.82 ** frames`) runs unconditionally
    in the same animation-frame loop as inertia, every frame, regardless
    of whether a drag is active -- closing the exact gap flagged earlier:
    sitting exactly at frac=0 (the untouched default view) used to fully
    absorb the very first pixel of a boundary-ward drag with zero visual
    feedback; now that absorbed delta is what feeds overscroll growth, so
    the first pixel already shows give.

    Verified in-browser: a fast flick keeps moving well past release and
    decays smoothly (frac 0.563 at release -> new origin reached at
    +100ms -> further still at +500ms); pushing into the root boundary
    reveals a growing blank margin (up to ~29px in testing) that fully
    springs back within ~600ms of release; the same holds for zoom-out
    past the minimum generation (blank margin up to ~43px, settling back
    to ~1px); a single small push from the untouched default view already
    shows visible give (23px), closing the dead-zone gap; and tapping
    down again mid-fling stops all motion dead, confirmed by two readings
    taken strictly after the tap (avoiding a timing artifact where
    Playwright's own command latency let real inertia run unaccounted-for
    between an earlier "mid-fling" read and the tap itself).

    Also added: single-finger vertical drag now zooms (up = in, matching
    the layout's own "up = finer generations"), combined with horizontal
    pan in the same gesture -- mirrors how pinch already combines both.
[ ] Add the tile cache + compositing for performance.
[ ] Iterate: placeholder fade-in, edge clamping polish, tune inertia feel.

## UI pass (headline, layout, tap-to-select)

Tagline in the headline, tighter body padding, a line break after the
origin number in the debug readout (it can get very long), dropped the
zoom-out button (drag/pinch/wheel cover it), and minimal help text.

Tap-to-select: a "tap" is a single pointer whose down/up positions are
within 8px of each other and never joined by a second pointer (ruling out
drags and pinches) — checked once at release, not tracked continuously
through movement. Tapping a prime cell highlights it with a blue border
and shows "selected prime: N" below (line-broken after the label, since
N can be arbitrarily large at depth); tapping a non-prime cell or missing
entirely clears/leaves the selection.

Selection is stored as `(n, gen)` — an absolute generation number, same
idea as `camera.bottomGen` — never a screen position, so the highlight
re-locates correctly every frame as the camera pans/zooms, and simply
stops rendering once the cell scrolls out of the visible row range.

The hit-test math (screen point -> cell) and the highlight's forward math
(cell -> screen rect) are exact inverses by construction, so they're
tested as a pair: `selectionScreenRect`/`hitTestAt` in view.ts are pure
functions (rows/canvasSize as plain-number params, no DOM canvas touched)
specifically so they're unit-testable without jsdom. view.test.ts sweeps
every on-screen cell across 5 cameras x 3 overscroll states and confirms
tapping the center of each cell's forward-computed rect returns that same
cell — the same "verify the invariant across a matrix of states," not
just a few examples, that caught the zoom-anchor bug earlier.

## Reported-drift fixes, digit counts, shareable URLs

Two real bugs found from actual usage, plus two small features.

**Vertical drift while panning right.** Root cause: single-finger drag's
zoom used the *live cursor X* as `zoomAtAnchor`'s anchor — but that same
X is simultaneously driving the horizontal pan, so any vertical
component at all (even tiny, off-center jitter during an intended pure
horizontal drag) triggered zoomAtAnchor's own internal pan-to-preserve-
the-anchor, compounding with the explicit pan every frame. Fixed by
pinning single-drag zoom to a fixed center anchor (0.5) — decouples the
axes completely, since the compensating pan is now a fixed proportion of
the zoom amount rather than tied to wherever the finger happens to be.
Pinch keeps its live midpoint anchor; that's a real independent
reference (two fingers), not the same coordinate driving something else.
Verified with synthetic pointer events carrying identical fixed
timestamps (deterministic, unlike real mouse timing) — the same
drag path from two different starting X positions now produces
byte-identical results.

**Overscroll "overshoots and rests slightly positive."** Root cause:
overscroll's own decay (0.82/frame) is faster than pan/zoom velocity's
decay (0.94/frame), so while inertia was still coasting into an
already-clamped boundary, each frame re-fed a small amount of overscroll
growth (via the same raw-minus-damped absorption as the original damping
work) faster than it could settle — reads as lingering just above zero
instead of resting at the border. Fixed by checking the boundary
*before* applying an inertia tick: if we're already at the root/min-zoom
and still pushing into it, that hit absorbs into overscroll once and then
kills velocity outright, rather than let it decay naturally over many
more frames while re-triggering growth each tick. Verified: overscroll
now reaches exactly 0 within ~200ms of release and stays there (sampled
every 100ms for 2s).

**Digit counts.** `origin` and `selected prime` now show
`(N digits)` next to the value — decimal digits, pluralized.

**Shareable URLs.** `origin` and `selected` (if any) are written to
`location.hash` via `history.replaceState` (never `pushState` — no new
history entries per drag frame) and read back once on load. Two
robustness choices: writes are debounced (300ms of quiet after the last
`draw()`) rather than per-frame, both because a URL mid-fling isn't a
meaningful "view" to share and because browsers rate-limit rapid
`history.replaceState` calls (verified: hash stays empty while inertia
is still coasting, e.g. through 1500ms in one test run, and appears the
moment motion actually settles — not a bug, the debounce working as
intended). And a restored `selected` is re-validated with `isPrime`
rather than trusted from the URL, so a hand-edited or stale link can't
show a false "selected prime"; malformed BigInt input falls back to
defaults the same way. `bottomGen` on restore is *not* preserved
exactly — it's reconstructed from origin's own bit length, a reasonable
fresh starting point for a shared link even though the live camera
deliberately avoids deriving bottomGen that way during panning (see the
note on that in camera.ts).

## Bigger canvas, boundary-snap physics

**Image size.** The first padding cut (1.5rem -> 0.75rem) barely moved
anything: `#canvas-wrap`'s `min(80vmin, 640px)` was the actual binding
constraint on any normal screen, not body padding (12px is negligible
next to the vmin/viewport gap). This time raised the real lever —
`min(94vmin, 760px)` — and trimmed padding further (0.75rem -> 0.4rem)
on top. Verified: 390px-wide viewport now renders a 367px canvas
(previously would've been ~300px, still 80vmin-capped); 900px viewport
now hits the 760px ceiling.

**Boundary-snap bias.** "frac and zoomFrac both at 0" is exactly "image
boundaries on block boundaries" — at that state every row's cells align
with no partial cells anywhere (zoomFrac=0 additionally means no
fractional scale, pixel-perfect). Added a gentle exponential ease toward
whichever of {0, 1} is nearer on each axis, live in motionTick alongside
velocity-driven inertia — deliberately *additive*, not a replacement or
a hard snap: at strong-fling speeds it's negligible (verified: 80ms
after a fast release, frac had already moved from 0.395 to 0.762,
clearly momentum-dominated, bias contributing ~nothing perceptible), and
only comes to dominate once velocity has mostly decayed. Verified the
full trajectory over 6s: smooth monotonic convergence toward 0 on both
axes even when residual post-release velocity initially carries the
camera further from the target first (frac peaked at 0.415 before
easing down to 0.024 by t=6s) — the bias doesn't fight momentum, it
just wins eventually. Zoom's bias anchors at a fixed center (0.5),
consistent with the earlier axis-decoupling fix, since this isn't tied
to any cursor position.

Noted but out of scope for this pass: holding the pointer stationary
before releasing doesn't currently decay velocity (decay only runs in
the motion loop, which pauses while a pointer is down), so a "drag then
pause before lifting" release can still carry more residual velocity
than expected. Not what was asked here; flagged for later if it turns
out to matter in practice.

## Boundary-snap bias: gated, not always-on

Feedback after using the always-additive bias above: tone it down, don't
apply it during medium/fast motion (only ramp in during the slow tail),
and only apply it when the corner is already close (~1/8-1/16) to a grid
vertex. The always-additive version was *weak* enough not to fight a
fling, but it was still doing work at every speed and every offset —
this pass makes it inert outside a narrow window instead of merely
small.

Two independent gates, both multiplicative on the existing ease:

- **Velocity ramp.** `speed = hypot(panVelocity, zoomVelocity)` — valid
  to combine directly since both are the same "distance unit per ms"
  scale (dFrac=1 and dZoom=1 both correspond to canvasSize/2 = 256
  canvas px of drag, see `ZOOM_DRAG_PIXELS`). A smoothstep from
  `SNAP_VELOCITY_FULL` (0.00006, ~15 px/s) to `SNAP_VELOCITY_ZERO`
  (0.0006, ~150 px/s) maps to a 1->0 multiplier: full bias strength at
  or below a near-standstill speed, zero bias at or above a modest
  walking-pace drag speed, smooth in between so it can't produce a
  visible kink as a fling decays through the band.
- **Proximity gate.** A hard gate (not ramped): `min(x, 1-x) < 1/8` on
  *both* `frac` and `zoomFrac` before any bias applies at all. "The
  image corner" is a single 2D point, so both coordinates have to
  already be near their own boundary — a slow drag sitting mid-cell on
  either axis gets no nudge, however slow it is.

Verified: with the old thresholds (release velocity, then check bias
contribution at t=80ms/mid-fling) the combined speed sits well above
`SNAP_VELOCITY_ZERO`, so `velocityRamp` is exactly 0 during that entire
window — the bias term contributes nothing until the fling has actually
decayed into the slow tail, and even then only fires once the camera
happens to coast to within 1/8 of a boundary on both axes. A settle
smoke test (fast fling, then a tiny sub-boundary nudge) still converges
cleanly to a whole-number origin with no jumps or console errors.

## Boundary-snap bias: stronger inside 1/8, decoupled per axis

Follow-up feedback: the joint (both-axes) gate above made the bias fire
too rarely to be felt in practice — a pure horizontal pan almost never
has zoomFrac sitting near its own boundary at the same time. Ask was to
(a) make it noticeably stronger — actually converge — once resting
within 1/8 of a vertex, and (b) extend a lighter touch out to 1/4, weak
enough that it doesn't start a stationary point moving on its own.

Two changes:

- **Decoupled per axis.** Dropped the "both frac and zoomFrac close"
  requirement; pan and zoom now each get their own proximity check
  against their own boundary. A pure pan now reliably feels the bias
  near a pan boundary regardless of where zoomFrac happens to sit.
- **Two-zone proximity curve** (`proximityStrength`): a plateau at
  `SNAP_STRONG_STRENGTH` (0.08/frame) within `SNAP_STRONG_PROXIMITY`
  (1/8) of a boundary, linearly tapering to `SNAP_WEAK_STRENGTH`
  (0.004/frame) by `SNAP_WEAK_PROXIMITY` (1/4), zero beyond.
- **Weak-zone motion requires existing velocity** (`snapStrength`): the
  1/8-1/4 band only applies while that axis's own velocity is still
  nonzero (i.e. genuinely mid-decay from a fling) — never to a point
  that's already come fully to rest there. The strong zone has no such
  restriction, so a point that settles inside 1/8 keeps slowly
  converging on the vertex even after velocity has fully zeroed out.

Verified numerically (simulating the per-frame recurrence directly,
matching the exact formula in motionTick): at rest with `frac = 0.06`
(inside 1/8), converges to effectively 0 within ~2s (frac 0.055 -> 0.0045
-> 0.0004 -> 0 over 120 frames). At rest with `frac = 0.2` (inside 1/4,
outside 1/8) with zero velocity, `frac` is unchanged after 180 frames —
confirms the weak zone never self-starts. With a small residual
velocity at `frac = 0.2`, it nudges to ~0.151 over the ~5 frames before
velocity decays below the cutoff and the nudging stops on its own —
"a little bit of bias," not a full pull to the vertex.

## Boundary-snap bias: wider zones (1/4 strong, 1/2 weak)

Feedback after using the above: "very smooth, let's try bigger zones" —
widened `SNAP_STRONG_PROXIMITY` from 1/8 to 1/4 and `SNAP_WEAK_PROXIMITY`
from 1/4 to 1/2. Since `distToNearestBoundary` maxes out at exactly 0.5
(at `frac`/`zoomFrac` = 0.5, the farthest possible point from either
boundary and also where the target flips), the weak zone at 1/2 now
covers essentially the *entire* range — every frac/zoomFrac value gets
at least a faint pull toward its nearer boundary, vanishing only in the
limit at the exact midpoint. `snapStrength`'s at-rest gating is
unchanged and still does its job at the new scale: verified at rest
with `frac = 0.2` (now inside the strong 1/4 zone) it converges cleanly
to 0 over ~180 frames; at rest with `frac = 0.4` (inside the new 1/2
weak zone, outside 1/4) it stays exactly put with zero velocity, and
only nudges (0.4 -> ~0.30) while residual velocity is still nonzero,
same as before just rescaled to the wider bands.

## Boundary-snap bias: dialed back to 1/6 strong, 1/3 weak

1/4-and-1/2 read as "a little too big" — settled between the two
tried-so-far pairs (1/8-1/4, 1/4-1/2) at `SNAP_STRONG_PROXIMITY = 1/6`,
`SNAP_WEAK_PROXIMITY = 1/3`. Everything else (the at-rest gating in
`snapStrength`, the velocity ramp, per-axis independence) is unchanged
— this is purely a constants tweak.

## Wrap the origin readout for very long primes

Bug report: navigating to a ~75-digit origin stretched the page wider
than the viewport and visibly decentered the whole layout (canvas
included). Root cause: `#selected` already had `overflow-wrap: anywhere`
+ `max-width: 90vw` (added earlier for exactly this reason — see the
"line break after large numbers" note), but `#readout`, which shows the
current origin, never got the same treatment — a long digit run has no
natural break point, so without `overflow-wrap` the browser renders it
as one unbreakable line and the flex-centered body grows to fit it.

Fix: mirrored `#selected`'s `overflow-wrap: anywhere; max-width: 90vw;`
onto `#readout`. Verified with Playwright: loading `#origin=<75-digit
number>` at a 400px viewport, before the fix `document.documentElement.
scrollWidth` was 517px (overflowing) and the canvas was pushed ~117px
off-center; after the fix scrollWidth matches the viewport exactly and
the canvas stays centered, with the origin readout simply wrapping to
multiple lines instead.

## Incremental buffer updates + a hard zoom-depth cap

Report: navigation starts to jank once origin passes ~80 digits, though
it stays usable to ~200. Root cause: `CameraRenderer.ensureBuffer()`
fully re-tested all ~1,500 visible cells for primality every time
`origin` or `bottomGen` changed — which happens on essentially every
single-cell pan/zoom step during a drag — and bigint `modPow` cost grows
with bit length, so each step got steadily more expensive as origin
grew into hundreds of digits.

**Incremental buffer updates** (`view.ts`). `ensureBuffer` now reuses
the previous buffer's pixels via `drawImage` instead of retesting
everything, for the two step shapes that actually happen during
interactive pan/zoom:

- **Pan by exactly one cell** (`origin` ± 1, `bottomGen` unchanged):
  every row's content shifts by exactly `canvasSize/2` px, regardless of
  which generation that row represents. This falls out of the buffer's
  own geometry — each row spans the same `BOTTOM_ROW_CELLS * 2^(rows-1)`
  pixel width no matter its cell count, so a `origin*2^j` shift in
  world-space cell coordinates is always the same `2^(rows-1)` px shift
  on screen. `panShift` blits the reusable `canvasSize - canvasSize/2`
  px into place and redraws only the newly-exposed margin strip (the
  buffer's built-in pan-margin cell, extended to every row).
- **Zoom in by exactly one generation** (`bottomGen` + 1, `origin` =
  old×2 or old×2+1): the layout has a neat identity — `top(j) ===
  height(j)` for every row `j`, because the row heights form a
  geometric series anchored by the 1px cap row. That makes the new
  buffer's rows `[0, rows-2]` *exactly* a crop+2x-scale of the old
  buffer's rows `[1, rows-1]`, with the crop's x-offset picked by which
  child (`frac < 0.5` vs `>= 0.5`) the zoom descended into — the same
  crop+scale relationship `draw()` already applies for sub-generation
  `zoomFrac`, just baked into the cache. Only the new finest row (never
  previously cached at any zoom level) needs real primality tests.
  Zoom-out isn't optimized this way — the reverse direction needs *more*
  horizontal data than the old buffer has, so it falls back to a full
  redraw, same as before.
- Anything else (multi-step jumps, hash navigation, first paint) also
  falls back to a full redraw — the fallback is just the old behavior,
  not a regression.

Both incremental paths use a persistent scratch canvas rather than
relying on same-canvas `drawImage` self-overlap semantics, and both the
buffer and scratch contexts get `imageSmoothingEnabled = false` (new —
previously only the on-screen `ctx` had it set, which didn't matter
before since the buffer was always painted with flat `fillRect`s; now
that it's also a `drawImage` *source* being scaled 2x, smoothing would
blur the crisp cell edges).

Verified two ways. Correctness: a Vite-dev-server harness importing
`camera.ts`/`view.ts` directly (not the built bundle) drove a
`CameraRenderer` through single pan-right, pan-left, zoom-into-left-
child, zoom-into-right-child, a deep-origin (~90 bits) zoom-in, and a
six-step chained pan/zoom/pan sequence, comparing `canvas.toDataURL()`
against a *fresh* `CameraRenderer` jumping straight to the same end
camera (always a full redraw, no incremental path) — pixel-identical in
every case, plus a sanity check confirming two genuinely different
cameras do NOT match (so the comparison isn't vacuous). Performance: at
a ~200-digit (664-bit) origin, a full redraw averaged 347ms; a warm
incremental pan step averaged 107ms (~3.3x) and a warm incremental
zoom-in step averaged 180ms (~1.9x) — a real improvement, not a full
elimination of cost at extreme depth, since the newly-exposed row still
needs genuine primality tests at that bit length.

**MAX_BOTTOM_GEN cap** (`camera.ts`). Added a hard backstop mirroring
`MIN_BOTTOM_GEN`'s existing treatment at the other end: `MAX_BOTTOM_GEN
= 663` (origin's bit-length tops out at 664, which keeps its decimal
digit count at or below 200 — 665 bits would allow 201), with
`dampZoomDelta` decelerating zoom-in as `zoomFrac` approaches the cap
the same way it already decelerates zoom-out at the root, and `zoomBy`
clamping `zoomFrac` to 1 instead of rebasing past it. `main.ts`'s
`motionTick` zeroes zoom velocity outright on hitting the cap (mirroring
the existing root-boundary treatment) instead of letting it decay
naturally into repeated no-op pushes. Also closed a related gap:
`parseHashOrigin` now rejects a hand-edited URL whose origin exceeds the
cap — `cameraFromHash` derives `bottomGen` straight from origin's bit
length, bypassing `zoomBy`'s normal clamp entirely, so an untrusted URL
could otherwise smuggle in an arbitrarily large origin.

## Tighten the zoom-depth cap to 200 digits

Follow-up: "let's cap it at 200 digits" — lowered `MAX_BOTTOM_GEN` from
the earlier ~300-digit-equivalent value (1000) to 663 (bit-length 664),
which keeps origin's own decimal digit count at or below 200 exactly
(verified: `(2n**664n - 1n).toString().length === 200`,
`(2n**665n - 1n).toString().length === 201`). No other logic changed —
`dampZoomDelta`, `zoomBy`'s clamp, and the hash-origin guard all key off
the same constant.

## Favicon: a small rendering of the app's own default view

Request: "use a small version of the main plot with origin=2" for the
browser tab icon. Computed a standalone 32x32 SVG (5 generations,
`BOTTOM_ROW_CELLS=2` — no pan margin needed for a static image) using
the same row-layout algorithm as `view.ts`'s `layoutRows`, then
hardcoded it as a base64 `data:image/svg+xml` URI on a `<link
rel="icon">` in `index.html` — no separate asset file, keeping the
single-self-contained-index.html property, and no extra network
request.

The bottom half renders solid black: 2 and 3 (the first two integers at
origin=2) are both prime, so row 0's two cells fill the whole lower
half — an accurate, if visually bold, reflection of the app's actual
default view, not an artifact. Verified: computed primality for the 62
integers spanning the 5 visible generations (2..63) independently of
`primes.ts` (small trial-division, values this small don't need
Miller-Rabin) to build the rect list, then rendered the resulting SVG
in a real browser at several sizes (16/32/64px) and confirmed the built
`dist/index.html`'s `<link rel="icon">` resolves with the correct
`data:image/svg+xml` href and type.
