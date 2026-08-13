/**
 * Continuous camera over the primex integer tree.
 *
 * x (pan): `origin` is a bigint anchoring a specific integer; `frac` is the
 * continuous offset within origin's own cell, in units of that cell's
 * width. (Origin's cell always spans exactly half the canvas, since the
 * bottom row always has exactly 2 cells: origin and origin+1.)
 *
 * y (zoom): `bottomGen` is a plain zoom-depth counter — it is NOT
 * recomputed from origin's bit length, deliberately. Panning across a
 * power-of-2 boundary (e.g. origin 3 -> 4) changes origin's true bit
 * length but is not a zoom event, and must not change the rendered scale.
 * Only zoomBy() changes bottomGen. `zoomFrac` is the continuous offset
 * toward bottomGen +/- 1.
 *
 * Both axes rebase through `origin` alone, so neither float ever has to
 * carry precision proportional to zoom depth: `frac` and `zoomFrac` stay
 * bounded in [0, 1) forever, no matter how deep `origin` gets.
 */
export interface Camera {
  readonly origin: bigint;
  readonly frac: number;
  readonly bottomGen: number;
  readonly zoomFrac: number;
}

export const MIN_ORIGIN = 2n;
export const MIN_BOTTOM_GEN = 1;

export function makeCamera(
  origin: bigint = MIN_ORIGIN,
  bottomGen: number = MIN_BOTTOM_GEN,
): Camera {
  return {origin, frac: 0, bottomGen, zoomFrac: 0};
}

/** Pans by `dFrac` cells (positive = right). Rebases `origin` on overflow. */
export function panBy(camera: Camera, dFrac: number): Camera {
  let origin = camera.origin;
  let frac = camera.frac + dFrac;

  const whole = Math.floor(frac);
  if (whole !== 0) {
    origin += BigInt(whole);
    frac -= whole;
  }

  if (origin < MIN_ORIGIN) {
    origin = MIN_ORIGIN;
    frac = 0;
  }

  return {...camera, origin, frac};
}

/**
 * Damps an input delta that would push further past a hard boundary
 * (root pan, or min zoom-out), so hitting the edge decelerates smoothly
 * instead of stopping dead. Has no effect anywhere else — this only
 * matters in the boundary cell/generation itself, where `frac`/`zoomFrac`
 * already measures distance from the true edge (0 = at the edge, 1 = a
 * full cell/generation away from it), which is exactly the damping factor
 * we want: the closer to the edge, the more a further push is absorbed.
 * Callers apply this to a raw input delta before passing it to panBy /
 * zoomBy, so it works the same for drag, wheel, and pinch alike.
 */
export function dampPanDelta(camera: Camera, dFrac: number): number {
  if (dFrac < 0 && camera.origin <= MIN_ORIGIN) {
    return dFrac * camera.frac;
  }
  return dFrac;
}

export function dampZoomDelta(camera: Camera, dZoom: number): number {
  if (dZoom < 0 && camera.bottomGen <= MIN_BOTTOM_GEN) {
    return dZoom * camera.zoomFrac;
  }
  return dZoom;
}

const MAX_ZOOM_STEPS_PER_CALL = 200;

/**
 * Zooms by `dZoom` generations (positive = in). Rebases origin/bottomGen
 * on overflow, generalizing the old zoomInLeft/zoomInRight/zoomOut taps:
 * `frac` decides which child to descend into (instead of a quadrant tap),
 * and is rescaled into the child's narrower cell on the way in, or
 * reconstructed from the parent's cell on the way out.
 */
export function zoomBy(camera: Camera, dZoom: number): Camera {
  let origin = camera.origin;
  let frac = camera.frac;
  let bottomGen = camera.bottomGen;
  let zoomFrac = camera.zoomFrac + dZoom;

  let whole = Math.floor(zoomFrac);
  zoomFrac -= whole;
  whole = Math.max(-MAX_ZOOM_STEPS_PER_CALL, Math.min(MAX_ZOOM_STEPS_PER_CALL, whole));

  while (whole > 0) {
    const rightChild = frac >= 0.5;
    origin = origin * 2n + (rightChild ? 1n : 0n);
    frac = rightChild ? frac * 2 - 1 : frac * 2;
    bottomGen += 1;
    whole -= 1;
  }
  while (whole < 0) {
    if (bottomGen <= MIN_BOTTOM_GEN) {
      zoomFrac = 0;
      break;
    }
    const wasOdd = origin % 2n === 1n;
    origin /= 2n;
    frac = (frac + (wasOdd ? 1 : 0)) / 2;
    bottomGen -= 1;
    whole += 1;
  }

  return {origin, frac, bottomGen, zoomFrac};
}
