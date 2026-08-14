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
