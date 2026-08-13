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
[ ] Add inertia on top of step 2's interaction, plus real rubber-band
    overshoot at the root/min-zoom boundary (a small bounce past the edge
    that eases back to zero on release) — folded in here rather than
    built separately, since both need the same live animation loop.
    Interim fix already in place: `dampPanDelta`/`dampZoomDelta` in
    camera.ts scale an input delta by the current distance from the edge
    (`frac`/`zoomFrac`), so drifting back toward the boundary decelerates
    smoothly. It has a real gap the rubber-band work should close: sitting
    exactly at the edge (frac=0, e.g. the untouched default view), that
    scaling factor is 0, so the very first pixel of a boundary-ward drag
    is still fully absorbed rather than giving a little.
    Also added: single-finger vertical drag now zooms (up = in, matching
    the layout's own "up = finer generations"), combined with horizontal
    pan in the same gesture — mirrors how pinch already combines both.
[ ] Add the tile cache + compositing for performance.
[ ] Iterate: placeholder fade-in, edge clamping polish, tune inertia feel.
