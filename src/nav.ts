import {MIN_ORIGIN} from './view';

/** Zoom into the left child subtree: (origin, origin+1) -> (2*origin, 2*origin+1). */
export function zoomInLeft(origin: bigint): bigint {
  return origin * 2n;
}

/** Zoom into the right child subtree: (origin+1)'s children -> (2*origin+2, 2*origin+3). */
export function zoomInRight(origin: bigint): bigint {
  return origin * 2n + 2n;
}

/**
 * Zoom out to the parent pair. origin's parent is origin/2; the pair
 * containing that parent is the even integer <= parent. Clamped at the
 * root pair (2, 3), which has no parent to zoom out to.
 */
export function zoomOut(origin: bigint): bigint {
  if (origin <= MIN_ORIGIN) return MIN_ORIGIN;
  const parent = origin / 2n;
  return parent % 2n === 0n ? parent : parent - 1n;
}

/** Pan to the neighboring sibling pair at the same level, if in range. */
export function panLeft(origin: bigint): bigint {
  return origin - 2n >= MIN_ORIGIN ? origin - 2n : origin;
}

export function panRight(origin: bigint): bigint {
  return origin + 2n;
}

export type NavZone = 'zoom-in-left' | 'zoom-in-right' | 'zoom-out' | 'pan-left' | 'pan-right';

const EDGE_MARGIN = 0.1;

/** Determines which navigation action a click/tap at fractional (x, y) triggers. */
export function hitTest(xFraction: number, yFraction: number): NavZone {
  if (xFraction < EDGE_MARGIN) return 'pan-left';
  if (xFraction > 1 - EDGE_MARGIN) return 'pan-right';
  if (yFraction > 0.5) return 'zoom-out';
  return xFraction < 0.5 ? 'zoom-in-left' : 'zoom-in-right';
}

export function applyNav(origin: bigint, zone: NavZone): bigint {
  switch (zone) {
    case 'zoom-in-left':
      return zoomInLeft(origin);
    case 'zoom-in-right':
      return zoomInRight(origin);
    case 'zoom-out':
      return zoomOut(origin);
    case 'pan-left':
      return panLeft(origin);
    case 'pan-right':
      return panRight(origin);
  }
}
