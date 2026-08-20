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

function fillRowCells(ctx: CanvasRenderingContext2D, row: Row, cStart: number, cEnd: number): void {
  for (let c = cStart; c < cEnd; c++) {
    const n = row.start + BigInt(c);
    if (isPrime(n)) {
      ctx.fillRect(c * row.height, row.top, row.height, row.height);
    }
  }
}

/**
 * Draws `rows` (primality-testing only the cells that fall in it), clipped
 * to the horizontal pixel range [xStart, xEnd) and white-filling that same
 * strip across `bufferHeight` first. Used both for a full-buffer redraw
 * (rows = all of them, xStart/xEnd = the whole width) and for redrawing
 * just a newly-exposed margin strip after CameraRenderer reuses the rest
 * of a previous buffer — see ensureBuffer.
 */
function drawRowsRange(
  ctx: CanvasRenderingContext2D,
  rows: Row[],
  xStart: number,
  xEnd: number,
  bufferHeight: number,
): void {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(xStart, 0, xEnd - xStart, bufferHeight);

  ctx.fillStyle = '#000000';
  for (const row of rows) {
    const cStart = Math.max(0, Math.floor(xStart / row.height));
    const cEnd = Math.min(row.cellCount, Math.ceil(xEnd / row.height));
    fillRowCells(ctx, row, cStart, cEnd);
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
 *
 * `selected`, if given, highlights one integer's cell with a blue border
 * — tracked as (n, gen) rather than a screen position, so it stays
 * correctly placed as the camera moves and simply stops being drawn once
 * panned/zoomed out of the visible row range. hitTest() is the inverse:
 * screen point -> which integer's cell contains it.
 */
export interface Selection {
  readonly n: bigint;
  /** Absolute generation (camera.bottomGen + row-index at the time this
   * cell was picked), not derived from n's bit length — same reasoning
   * as camera.ts's bottomGen: it must stay stable as the camera pans. */
  readonly gen: number;
}

export interface ScreenRect {
  readonly x: number;
  readonly y: number;
  readonly size: number;
}

/** A single concentric-ring border: which fact category it represents
 * (color) and its fixed position in the nesting order (depth — see
 * PrimeFact.depth in primeFacts.ts for why this is a category identity,
 * not an array index). */
export interface RingHighlight {
  readonly color: string;
  readonly depth: number;
}

/** A ring highlight for a cell other than the primary selection — needs
 * its own screen position, since it can be anywhere in the visible rows. */
export interface RelatedRingHighlight extends RingHighlight {
  readonly selection: Selection;
}

/**
 * Per-ring gap: a fraction of the cell's own on-screen size, clamped to a
 * sensible pixel range. Pure percentage scaling turns out to overcorrect
 * at both ends — a fixed px gap ate a disproportionate share of a small
 * cell, but scaling *without* a ceiling makes a large cell's gaps look
 * chunky/spaced-out instead of a tight nested bullseye (a 256px cell at
 * 5% is a ~13px gap per ring). Clamping keeps it visually tight and
 * consistent across the whole size range instead of degrading at
 * whichever extreme the fraction wasn't tuned for.
 */
const RING_GAP_FRACTION = 0.02;
const RING_GAP_MIN_PX = 1;
const RING_GAP_MAX_PX = 3;

/**
 * Insets `rect` for a ring at `depth` (0 = flush with `rect` itself, 1 =
 * one gap further in, ...), offset by `baseInsetSteps` first — used to
 * leave room for the selected cell's own outer blue "this is selected"
 * ring, which related-highlight cells don't have. Both are counted in
 * gap-sized steps, not raw pixels, so they scale together. Returns null
 * once nesting has eaten the whole cell (a small on-screen cell only
 * fits so many rings), so the caller can just skip drawing it.
 */
export function ringRect(rect: ScreenRect, depth: number, baseInsetSteps: number): ScreenRect | null {
  const gapPx = Math.min(RING_GAP_MAX_PX, Math.max(RING_GAP_MIN_PX, rect.size * RING_GAP_FRACTION));
  const inset = (baseInsetSteps + depth) * gapPx;
  const size = rect.size - inset * 2;
  if (size <= 0) return null;
  return {x: rect.x + inset, y: rect.y + inset, size};
}

/**
 * Where `selected`'s cell currently sits in canvas-pixel space, or null if
 * it's not in the visible row range (panned/zoomed away) — pure geometry,
 * factored out of draw() so it's unit-testable without a DOM canvas. This
 * and hitTestAt() are exact inverses of each other by construction (see
 * the round-trip tests in view.test.ts) — that property is what matters,
 * more than either formula individually.
 */
export function selectionScreenRect(
  rows: number,
  canvasSize: number,
  camera: Camera,
  selected: Selection,
  overscrollXPixels: number,
  overscrollZoomOut: number,
): ScreenRect | null {
  const j = selected.gen - camera.bottomGen;
  if (j < 0 || j >= rows) return null;

  const row = layoutRows(camera.origin, rows)[rows - 1 - j];
  const c = selected.n - camera.origin * 2n ** BigInt(j);
  if (c < 0n || c >= BigInt(row.cellCount)) return null;

  const zoomScale = 2 ** (camera.zoomFrac - overscrollZoomOut);
  const cropX = camera.frac * (canvasSize / 2);
  const bufX = Number(c) * row.height;

  return {
    x: (bufX - cropX) * zoomScale + overscrollXPixels,
    y: row.top * zoomScale,
    size: row.height * zoomScale,
  };
}

/**
 * Inverse of draw()'s transform: given a point in canvas-pixel space
 * (same units as `canvasSize`), returns the prime integer whose cell
 * contains it — or null if the point misses (blank cap row, out of buffer
 * bounds) or lands on a non-prime cell.
 */
export function hitTestAt(
  rows: number,
  canvasSize: number,
  camera: Camera,
  canvasX: number,
  canvasY: number,
  overscrollXPixels: number,
  overscrollZoomOut: number,
): Selection | null {
  const zoomScale = 2 ** (camera.zoomFrac - overscrollZoomOut);
  const bufX = (canvasX - overscrollXPixels) / zoomScale + camera.frac * (canvasSize / 2);
  const bufY = canvasY / zoomScale;

  if (bufY < 1) return null; // Blank cap row.

  const rowList = layoutRows(camera.origin, rows);
  for (let idx = 0; idx < rowList.length; idx++) {
    const row = rowList[idx];
    if (bufY >= row.top && bufY < row.top + row.height) {
      const c = Math.floor(bufX / row.height);
      if (c < 0 || c >= row.cellCount) return null;
      const n = row.start + BigInt(c);
      if (!isPrime(n)) return null;
      const j = rows - 1 - idx;
      return {n, gen: camera.bottomGen + j};
    }
  }
  return null;
}

/**
 * Locates a specific integer among the currently visible rows, if it's
 * there — the value-space counterpart of hitTestAt's pixel-space lookup.
 * Used to find where a "related" number (e.g. a twin-prime partner) should
 * be highlighted, without assuming it shares the selected prime's own
 * generation (it usually does, but not if it happens to cross a
 * power-of-2 bit-length boundary). Doesn't check primality — the caller
 * already knows that.
 */
export function findVisibleSelection(rows: number, camera: Camera, n: bigint): Selection | null {
  const rowList = layoutRows(camera.origin, rows);
  for (let idx = 0; idx < rowList.length; idx++) {
    const row = rowList[idx];
    const c = n - row.start;
    if (c >= 0n && c < BigInt(row.cellCount)) {
      const j = rows - 1 - idx;
      return {n, gen: camera.bottomGen + j};
    }
  }
  return null;
}

export class CameraRenderer {
  readonly rows: number;
  readonly canvasSize: number;

  private readonly buffer: HTMLCanvasElement;
  private readonly bufferCtx: CanvasRenderingContext2D;
  // Scratch space for panShift/zoomInShift's blit-then-redraw: copying the
  // reusable part of the old buffer out before overwriting it, rather than
  // relying on same-canvas drawImage's (spec-legal but engine-dependent)
  // self-overlap semantics.
  private readonly scratch: HTMLCanvasElement;
  private readonly scratchCtx: CanvasRenderingContext2D;
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
    ctx.imageSmoothingEnabled = false;
    this.bufferCtx = ctx;

    this.scratch = document.createElement('canvas');
    this.scratch.width = this.buffer.width;
    this.scratch.height = this.buffer.height;
    const scratchCtx = this.scratch.getContext('2d');
    if (!scratchCtx) throw new Error('2d canvas context unavailable');
    scratchCtx.imageSmoothingEnabled = false;
    this.scratchCtx = scratchCtx;
  }

  /**
   * Rebuilds the (origin, bottomGen) buffer, reusing as much of the
   * previous buffer's pixels as possible instead of re-running primality
   * tests on all ~1500 visible cells every time origin or bottomGen
   * changes — which otherwise happens on essentially every single-cell
   * pan/zoom step, and gets expensive fast as origin grows into hundreds
   * of digits (bigint modPow cost grows with bit length). Two cases reuse
   * the old buffer via drawImage instead of retesting:
   *
   * - A plain pan (bottomGen unchanged, origin ± 1): the whole buffer is
   *   just the old one shifted by canvasSize/2 px — see panShift. Only
   *   the newly-exposed margin strip needs fresh primality tests.
   * - A single zoom-in step (bottomGen + 1, origin = old*2 or old*2+1):
   *   the self-similar row layout means rows [0, rows-2] of the new
   *   buffer are exactly a crop+2x-scale of the old buffer — see
   *   zoomInShift. Only the new finest row needs fresh tests.
   *
   * Anything else (zoom-out, multi-step jumps, hash navigation, first
   * paint) falls back to a full redraw. See PLAN.md for the derivation.
   */
  private ensureBuffer(origin: bigint, bottomGen: number): void {
    if (this.cachedOrigin === origin && this.cachedBottomGen === bottomGen) return;

    if (this.cachedOrigin !== null && this.cachedBottomGen === bottomGen) {
      if (origin === this.cachedOrigin + 1n) {
        this.panShift(origin, 1);
        this.cachedOrigin = origin;
        return;
      }
      if (origin === this.cachedOrigin - 1n) {
        this.panShift(origin, -1);
        this.cachedOrigin = origin;
        return;
      }
    } else if (this.cachedOrigin !== null && bottomGen === this.cachedBottomGen! + 1) {
      if (origin === this.cachedOrigin * 2n) {
        this.zoomInShift(origin, 0);
        this.cachedOrigin = origin;
        this.cachedBottomGen = bottomGen;
        return;
      }
      if (origin === this.cachedOrigin * 2n + 1n) {
        this.zoomInShift(origin, 1);
        this.cachedOrigin = origin;
        this.cachedBottomGen = bottomGen;
        return;
      }
    }

    drawRowsRange(this.bufferCtx, layoutRows(origin, this.rows), 0, this.buffer.width, this.buffer.height);
    this.cachedOrigin = origin;
    this.cachedBottomGen = bottomGen;
  }

  /**
   * Pan by exactly one cell: shifts the buffer's existing pixels by
   * canvasSize/2 px (every row's content moves by exactly that much when
   * origin ± 1, regardless of the row's own generation — see PLAN.md) and
   * redraws only the newly-exposed strip on the leading edge.
   */
  private panShift(newOrigin: bigint, direction: 1 | -1): void {
    const width = this.buffer.width;
    const height = this.buffer.height;
    const shiftPx = this.canvasSize / 2;
    const keepWidth = width - shiftPx;

    this.scratchCtx.clearRect(0, 0, width, height);
    if (direction > 0) {
      // Content moves left; new strip appears on the right.
      this.scratchCtx.drawImage(this.buffer, shiftPx, 0, keepWidth, height, 0, 0, keepWidth, height);
      this.bufferCtx.drawImage(this.scratch, 0, 0, keepWidth, height, 0, 0, keepWidth, height);
      drawRowsRange(this.bufferCtx, layoutRows(newOrigin, this.rows), keepWidth, width, height);
    } else {
      // Content moves right; new strip appears on the left.
      this.scratchCtx.drawImage(this.buffer, 0, 0, keepWidth, height, 0, 0, keepWidth, height);
      this.bufferCtx.drawImage(this.scratch, 0, 0, keepWidth, height, shiftPx, 0, keepWidth, height);
      drawRowsRange(this.bufferCtx, layoutRows(newOrigin, this.rows), 0, shiftPx, height);
    }
  }

  /**
   * Zoom in by exactly one generation: the self-similar row layout (every
   * row's pixel top equals its own height, by construction of the
   * geometric-series layout in layoutRows) means the new buffer's rows
   * [0, rows-2] are *exactly* a crop of the old buffer's rows [1, rows-1],
   * scaled 2x — the same crop+scale relationship CameraRenderer.draw()
   * already applies for sub-generation zoomFrac, just baked into the
   * cache instead of the on-screen composite. `child` (which half the new
   * origin descends into) picks the crop's x-offset. Only the new finest
   * row (previously outside every cached generation) needs fresh
   * primality tests.
   */
  private zoomInShift(newOrigin: bigint, child: 0 | 1): void {
    const width = this.buffer.width;
    const height = this.buffer.height;

    const cropWidth = width / 2;
    const cropOffsetX = child === 1 ? width / (2 * BOTTOM_ROW_CELLS) : 0;
    const srcY = 1; // Below the 1px cap row.
    const srcHeight = this.canvasSize / 2 - 1;
    const destY = 2 * srcY;
    const destHeight = 2 * srcHeight;

    this.scratchCtx.clearRect(0, 0, width, height);
    this.scratchCtx.drawImage(this.buffer, cropOffsetX, srcY, cropWidth, srcHeight, 0, 0, cropWidth, srcHeight);
    this.bufferCtx.drawImage(this.scratch, 0, 0, cropWidth, srcHeight, 0, destY, width, destHeight);

    // The cap row [0, 1) and the brand-new finest row [1, 2) both need
    // fresh content — draw them together in one white-fill + cell pass.
    const finestRow = layoutRows(newOrigin, this.rows)[0];
    drawRowsRange(this.bufferCtx, [finestRow], 0, width, destY);
  }

  draw(
    ctx: CanvasRenderingContext2D,
    camera: Camera,
    overscrollXPixels = 0,
    overscrollZoomOut = 0,
    selected: Selection | null = null,
    selectedRings: readonly RingHighlight[] = [],
    relatedRings: readonly RelatedRingHighlight[] = [],
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
    const cropX = camera.frac * (size / 2);

    ctx.save();
    // Overscroll translate goes first (screen-space pixels, unaffected by
    // the scale below), then the corner-anchored zoom as usual.
    ctx.translate(overscrollXPixels, 0);
    ctx.scale(zoomScale, zoomScale);
    ctx.drawImage(this.buffer, cropX, 0, size, size, 0, 0, size, size);
    ctx.restore();

    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, size - 1, size - 1);

    // Related highlights (e.g. a twin-prime partner) draw first, so the
    // primary blue selection always reads as the more prominent one even
    // where they'd overlap. Each fact category gets its own ring color at
    // its own fixed depth (see primeFacts.ts) — a cell related through
    // multiple facts gets one concentric ring per fact, not one flat
    // highlight, since that's the whole point of tracking depth per
    // category rather than per how-many-facts-this-prime-happens-to-have.
    for (const ring of relatedRings) {
      const rect = selectionScreenRect(
        this.rows,
        this.canvasSize,
        camera,
        ring.selection,
        overscrollXPixels,
        overscrollZoomOut,
      );
      if (!rect) continue;
      const inset = ringRect(rect, ring.depth, 0);
      if (!inset) continue;
      ctx.strokeStyle = ring.color;
      ctx.lineWidth = 2;
      ctx.strokeRect(inset.x, inset.y, inset.size, inset.size);
    }

    if (selected) {
      const rect = selectionScreenRect(
        this.rows,
        this.canvasSize,
        camera,
        selected,
        overscrollXPixels,
        overscrollZoomOut,
      );
      if (rect) {
        ctx.strokeStyle = '#2563eb';
        ctx.lineWidth = 2;
        ctx.strokeRect(rect.x, rect.y, rect.size, rect.size);

        // The selected prime's own category rings nest just inside the
        // blue selection border (baseInsetSteps=1 leaves it room), one
        // per fact.
        for (const ring of selectedRings) {
          const inset = ringRect(rect, ring.depth, 1);
          if (!inset) continue;
          ctx.strokeStyle = ring.color;
          ctx.lineWidth = 2;
          ctx.strokeRect(inset.x, inset.y, inset.size, inset.size);
        }
      }
    }
  }

  hitTest(
    camera: Camera,
    canvasX: number,
    canvasY: number,
    overscrollXPixels: number,
    overscrollZoomOut: number,
  ): Selection | null {
    return hitTestAt(
      this.rows,
      this.canvasSize,
      camera,
      canvasX,
      canvasY,
      overscrollXPixels,
      overscrollZoomOut,
    );
  }
}
