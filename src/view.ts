import {isPrime} from './primes';
import type {Camera} from './camera';

/**
 * Number of generations shown at once. Fixed — the continuous camera
 * changes *which* generations are visible (via `bottomGen`/`zoomFrac`),
 * not how many.
 */
export const VISIBLE_ROWS = 9;

/**
 * Row 0 (bottom) normally has exactly 2 cells: origin, origin+1. We render
 * one extra cell of margin on the right so a buffer built for the current
 * (origin, bottomGen) can be panned continuously — cropped and shown at any
 * `frac` offset in [0, 1) — without needing to re-run primality tests on
 * every frame. See PLAN.md's "Tile cache" section for why this margin is
 * exactly enough: zoom is a pure transform of the crop, it never needs to
 * sample outside it.
 */
const MARGIN_CELLS = 1;
const BOTTOM_ROW_CELLS = 2 + MARGIN_CELLS;

export function canvasSizeForRows(rows: number): number {
  return 2 ** rows;
}

function bufferWidthForRows(rows: number): number {
  return BOTTOM_ROW_CELLS * 2 ** (rows - 1);
}

interface Row {
  /** Distance in pixels from the top of the buffer to this row's top edge. */
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
 * 1 + (2^(rows-1) + ... + 2^0), which sums to exactly canvasSizeForRows.
 */
function layoutRows(origin: bigint, rows: number): Row[] {
  const result: Row[] = [];
  let top = 1; // Cap row occupies [0, 1).
  for (let j = rows - 1; j >= 0; j--) {
    const height = 2 ** (rows - 1 - j);
    const cellCount = BOTTOM_ROW_CELLS * 2 ** j;
    const start = origin * 2n ** BigInt(j);
    result.push({top, height, cellCount, start});
    top += height;
  }
  return result;
}

function drawRows(ctx: CanvasRenderingContext2D, width: number, height: number, rows: Row[]): void {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = '#000000';
  for (const row of rows) {
    for (let c = 0; c < row.cellCount; c++) {
      const n = row.start + BigInt(c);
      if (isPrime(n)) {
        ctx.fillRect(c * row.height, row.top, row.height, row.height);
      }
    }
  }
}

/**
 * Draws the continuous camera view. Internally renders a wider-than-canvas
 * buffer for (origin, bottomGen) — re-running primality tests only when
 * those change — then composites it onto `ctx` each call with a transform
 * derived from (frac, zoomFrac):
 *
 * - `frac` crops a canvasSize-wide window out of the buffer, sliding
 *   continuously from showing (origin, origin+1) at frac=0 to
 *   (origin+1, origin+2) at frac->1, matching what the buffer looks like
 *   right after the pan rebase in camera.ts.
 * - `zoomFrac` scales that crop by 2^zoomFrac about the top-left corner.
 *
 * Both anchors are forced by camera.ts's rebase rules, not chosen:
 * `frac' = 2*frac - c` maps the window's LEFT edge to the same world
 * point across a zoom rebase, and `bottomGen + 1` does the same for the
 * TOP edge. Anchoring anywhere else makes the render disagree with the
 * rebase, which shows up as a visible jump when zoomFrac wraps. To zoom
 * about the cursor instead, the *camera* compensates with a pan — see
 * zoomAtAnchor in camera.ts — leaving this transform always corner-based.
 *
 * `overscrollXPixels`/`overscrollZoomOut` are purely visual, layered on
 * top of an unchanged camera: pushing past the root/min-zoom boundary
 * shifts and shrinks the content a little (revealing white at the edge)
 * without the underlying camera state ever leaving its hard clamp. See
 * main.ts for how these grow and decay.
 */
export class CameraRenderer {
  readonly rows: number;
  readonly canvasSize: number;

  private readonly buffer: HTMLCanvasElement;
  private readonly bufferCtx: CanvasRenderingContext2D;
  private cachedOrigin: bigint | null = null;
  private cachedBottomGen: number | null = null;

  constructor(rows: number = VISIBLE_ROWS) {
    this.rows = rows;
    this.canvasSize = canvasSizeForRows(rows);

    this.buffer = document.createElement('canvas');
    this.buffer.width = bufferWidthForRows(rows);
    this.buffer.height = this.canvasSize;
    const ctx = this.buffer.getContext('2d');
    if (!ctx) throw new Error('2d canvas context unavailable');
    this.bufferCtx = ctx;
  }

  private ensureBuffer(origin: bigint, bottomGen: number): void {
    if (this.cachedOrigin === origin && this.cachedBottomGen === bottomGen) return;
    drawRows(this.bufferCtx, this.buffer.width, this.buffer.height, layoutRows(origin, this.rows));
    this.cachedOrigin = origin;
    this.cachedBottomGen = bottomGen;
  }

  draw(
    ctx: CanvasRenderingContext2D,
    camera: Camera,
    overscrollXPixels = 0,
    overscrollZoomOut = 0,
  ): void {
    this.ensureBuffer(camera.origin, camera.bottomGen);

    const size = this.canvasSize;
    ctx.imageSmoothingEnabled = false;
    // Explicit white fill, not clearRect: overscroll can reveal area past
    // the drawn buffer (there's nothing below the root to show), and that
    // area needs to read as "edge of the content," not a transparency bug.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);

    const zoomScale = 2 ** (camera.zoomFrac - overscrollZoomOut);

    ctx.save();
    // Overscroll translate goes first (screen-space pixels, unaffected by
    // the scale below), then the corner-anchored zoom as usual.
    ctx.translate(overscrollXPixels, 0);
    ctx.scale(zoomScale, zoomScale);
    ctx.drawImage(this.buffer, camera.frac * (size / 2), 0, size, size, 0, 0, size, size);
    ctx.restore();

    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, size - 1, size - 1);
  }
}
