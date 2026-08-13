import {isPrime} from './primes';

/**
 * A view is anchored at `origin`, an even integer >= 2. The bottom row of
 * the image shows the pair (origin, origin+1). Each row above shows the
 * children of the row below (i -> 2i, 2i+1), doubling the cell count and
 * halving the cell size each time, for `scale` rows total. This keeps the
 * image content bounded to O(2^scale) cells no matter how deep `origin`
 * has zoomed, since scale stays fixed while only origin grows.
 */
export interface ViewState {
  readonly scale: number;
  readonly origin: bigint;
}

export const DEFAULT_SCALE = 8;
export const MIN_ORIGIN = 2n;
export const DEFAULT_ORIGIN = MIN_ORIGIN;

export function canvasSizeForScale(scale: number): number {
  return 2 ** scale;
}

interface Row {
  /** Distance in pixels from the top of the image to this row's top edge. */
  readonly top: number;
  readonly height: number;
  readonly cellCount: number;
  /** Smallest integer represented in this row. */
  readonly start: bigint;
}

/**
 * Lays out rows top-to-bottom: a blank 1px cap row first, then the
 * numbered rows from the finest (top, height 1) down to the coarsest
 * (bottom, height canvasSize/2). Row heights form the geometric series
 * 1 + (2^(scale-1) + ... + 2^0), which sums to exactly canvasSize.
 */
function layoutRows(state: ViewState): Row[] {
  const {scale, origin} = state;
  const rows: Row[] = [];
  let top = 1; // Cap row occupies [0, 1).
  for (let j = scale - 1; j >= 0; j--) {
    const height = 2 ** (scale - 1 - j);
    const cellCount = 2 ** (j + 1);
    const start = origin * 2n ** BigInt(j);
    rows.push({top, height, cellCount, start});
    top += height;
  }
  return rows;
}

export function render(ctx: CanvasRenderingContext2D, state: ViewState): void {
  const size = canvasSizeForScale(state.scale);

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);

  ctx.fillStyle = '#000000';
  for (const row of layoutRows(state)) {
    for (let c = 0; c < row.cellCount; c++) {
      const n = row.start + BigInt(c);
      if (isPrime(n)) {
        ctx.fillRect(c * row.height, row.top, row.height, row.height);
      }
    }
  }

  // Thin border around the whole square image.
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, size - 1, size - 1);
}
