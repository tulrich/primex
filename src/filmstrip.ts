import {render, canvasSizeForScale, type ViewState} from './view';
import {panLeft, panRight} from './nav';

/**
 * Manages three canvases showing the current pan frame and its immediate
 * left/right neighbors (origin ± 2), so a drag can slide continuously
 * between pre-rendered screens instead of re-rendering every frame. The
 * canvas that scrolls off one side is recycled to become the newly exposed
 * neighbor on the other side, so a pan step costs exactly one render.
 */
export class Filmstrip {
  private readonly canvases: readonly [HTMLCanvasElement, HTMLCanvasElement, HTMLCanvasElement];
  private prevIdx = 0;
  private curIdx = 1;
  private nextIdx = 2;
  private scale = 0;
  private origin = 0n;

  constructor(canvases: readonly [HTMLCanvasElement, HTMLCanvasElement, HTMLCanvasElement]) {
    this.canvases = canvases;
  }

  get currentOrigin(): bigint {
    return this.origin;
  }

  /** True when panning further left (towards lower numbers) is a no-op. */
  get atLeftBoundary(): boolean {
    return panLeft(this.origin) === this.origin;
  }

  /** Fully (re)renders all three frames around `state`. */
  reset(state: ViewState): void {
    this.scale = state.scale;
    this.origin = state.origin;
    this.renderInto(this.canvases[this.prevIdx], panLeft(state.origin));
    this.renderInto(this.canvases[this.curIdx], state.origin);
    this.renderInto(this.canvases[this.nextIdx], panRight(state.origin));
  }

  /** Slides the window one step towards lower numbers. No-op at the boundary. */
  commitPanLeft(): void {
    const next = panLeft(this.origin);
    if (next === this.origin) return;
    this.origin = next;
    [this.prevIdx, this.curIdx, this.nextIdx] = [this.nextIdx, this.prevIdx, this.curIdx];
    this.renderInto(this.canvases[this.prevIdx], panLeft(this.origin));
  }

  /** Slides the window one step towards higher numbers. */
  commitPanRight(): void {
    this.origin = panRight(this.origin);
    [this.prevIdx, this.curIdx, this.nextIdx] = [this.curIdx, this.nextIdx, this.prevIdx];
    this.renderInto(this.canvases[this.nextIdx], panRight(this.origin));
  }

  /** Positions the three canvases for a horizontal drag offset in CSS px (positive = dragged right). */
  applyOffset(offsetPx: number): void {
    const px = `${offsetPx}px`;
    this.canvases[this.prevIdx].style.transform = `translateX(calc(-100% + ${px}))`;
    this.canvases[this.curIdx].style.transform = `translateX(${px})`;
    this.canvases[this.nextIdx].style.transform = `translateX(calc(100% + ${px}))`;
  }

  private renderInto(canvas: HTMLCanvasElement, origin: bigint): void {
    const size = canvasSizeForScale(this.scale);
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2d canvas context unavailable');
    render(ctx, {scale: this.scale, origin});
  }
}
