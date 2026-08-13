import {
  makeCamera,
  panBy,
  zoomBy,
  zoomAtAnchor,
  dampPanDelta,
  dampZoomDelta,
  MIN_ORIGIN,
  MIN_BOTTOM_GEN,
  type Camera,
} from './camera';
import {CameraRenderer} from './view';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('missing #app root');

app.innerHTML = `
  <h1>primex</h1>
  <div id="canvas-wrap"><canvas id="view"></canvas></div>
  <div id="readout"></div>
  <div id="controls">
    <button id="zoom-out">Zoom out</button>
    <button id="reset">Reset</button>
  </div>
  <p id="help">
    Drag sideways to pan, down to zoom in, up to zoom out.
    Pinch or scroll to zoom too.
  </p>
`;

const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
const readout = document.querySelector<HTMLDivElement>('#readout')!;
const zoomOutButton = document.querySelector<HTMLButtonElement>('#zoom-out')!;
const resetButton = document.querySelector<HTMLButtonElement>('#reset')!;
const ctx = canvas.getContext('2d');
if (!ctx) throw new Error('2d canvas context unavailable');

const renderer = new CameraRenderer();
canvas.width = renderer.canvasSize;
canvas.height = renderer.canvasSize;

let camera: Camera = makeCamera();

function draw(): void {
  renderer.draw(ctx!, camera);

  readout.textContent =
    `origin ${camera.origin}  ·  gen ${camera.bottomGen}  ·  ` +
    `frac ${camera.frac.toFixed(3)}  ·  zoomFrac ${camera.zoomFrac.toFixed(3)}`;
  zoomOutButton.disabled = camera.origin <= MIN_ORIGIN && camera.bottomGen <= MIN_BOTTOM_GEN;
}

// --- Pan/zoom via pointer events: one active pointer drags — sideways
// pans, up/down zooms, both from the same gesture (drag up = zoom in, to
// match the app's own "up = finer generations" layout). Two active
// pointers pinch instead: pan follows the midpoint, zoom follows the
// change in distance between them. Everything's tracked in units of the
// canvas's own pixel size so it's independent of CSS scaling. ---

function applyPan(dFrac: number): void {
  camera = panBy(camera, dampPanDelta(camera, dFrac));
}

/**
 * Zooms about `anchorFracX` (0 = left edge of the canvas, 1 = right), so
 * whatever sits under the cursor/fingers stays put instead of sliding
 * sideways as the view scales.
 */
function applyZoomAt(dZoom: number, anchorFracX: number): void {
  const damped = dampZoomDelta(camera, dZoom);
  if (damped === 0) return;
  camera = zoomAtAnchor(camera, damped, Math.min(1, Math.max(0, anchorFracX)));
}

/** Vertical drag distance, in canvas pixels, worth one full generation. */
const ZOOM_DRAG_PIXELS = 256;

const activePointers = new Map<number, {x: number; y: number}>();
let dragPointerId: number | null = null;
let lastDragX = 0;
let lastDragY = 0;
let pinchLastDist = 0;
let pinchLastMidX = 0;

function pinchMetrics(): {dist: number; midX: number} {
  const [a, b] = [...activePointers.values()];
  return {dist: Math.hypot(a.x - b.x, a.y - b.y), midX: (a.x + b.x) / 2};
}

/** (Re)starts single-drag or pinch tracking from the current pointer set. */
function beginGesture(pointerId: number): void {
  if (activePointers.size === 1) {
    dragPointerId = pointerId;
    const p = activePointers.get(pointerId)!;
    lastDragX = p.x;
    lastDragY = p.y;
  } else if (activePointers.size === 2) {
    dragPointerId = null;
    ({dist: pinchLastDist, midX: pinchLastMidX} = pinchMetrics());
  }
}

canvas.addEventListener('pointerdown', (event) => {
  activePointers.set(event.pointerId, {x: event.clientX, y: event.clientY});
  beginGesture(event.pointerId);
  // Best-effort: keeps receiving move/up events if the pointer leaves the
  // canvas mid-gesture. Not essential to gesture tracking, so a failure
  // here (e.g. an already-released pointer) shouldn't drop the pointer.
  try {
    canvas.setPointerCapture(event.pointerId);
  } catch {
    // Ignore — see comment above.
  }
});

canvas.addEventListener('pointermove', (event) => {
  if (!activePointers.has(event.pointerId)) return;
  activePointers.set(event.pointerId, {x: event.clientX, y: event.clientY});

  const rect = canvas.getBoundingClientRect();
  const canvasPixelsPerCssPixel = renderer.canvasSize / rect.width;

  if (activePointers.size >= 2) {
    const {dist, midX} = pinchMetrics();
    if (pinchLastDist > 0) {
      applyZoomAt(Math.log2(dist / pinchLastDist), (midX - rect.left) / rect.width);
      const dxCanvasPixels = (midX - pinchLastMidX) * canvasPixelsPerCssPixel;
      applyPan(-dxCanvasPixels / (renderer.canvasSize / 2));
    }
    pinchLastDist = dist;
    pinchLastMidX = midX;
    draw();
    return;
  }

  if (dragPointerId === event.pointerId) {
    const dxCanvasPixels = (event.clientX - lastDragX) * canvasPixelsPerCssPixel;
    const dyCanvasPixels = (event.clientY - lastDragY) * canvasPixelsPerCssPixel;
    lastDragX = event.clientX;
    lastDragY = event.clientY;
    // Content follows the pointer on both axes: dragging right reveals
    // lower origins, and dragging down zooms in — zooming in scales the
    // pyramid about its top edge, so its content moves down the screen.
    applyPan(-dxCanvasPixels / (renderer.canvasSize / 2));
    applyZoomAt(dyCanvasPixels / ZOOM_DRAG_PIXELS, (event.clientX - rect.left) / rect.width);
    draw();
  }
});

function releasePointer(event: PointerEvent): void {
  activePointers.delete(event.pointerId);
  if (dragPointerId === event.pointerId) dragPointerId = null;
  const remaining = [...activePointers.keys()];
  if (remaining.length === 1) beginGesture(remaining[0]);
}

canvas.addEventListener('pointerup', releasePointer);
canvas.addEventListener('pointercancel', releasePointer);

// --- Zoom: wheel (also how browsers report trackpad pinch, via ctrlKey). ---

const ZOOM_SPEED = 0.0015;

canvas.addEventListener(
  'wheel',
  (event) => {
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    // Scroll up = zoom in, the usual desktop convention. (Deliberately the
    // opposite sense from vertical drag, which follows the finger instead.)
    applyZoomAt(-event.deltaY * ZOOM_SPEED, (event.clientX - rect.left) / rect.width);
    draw();
  },
  {passive: false},
);

zoomOutButton.addEventListener('click', () => {
  camera = zoomBy(camera, -1);
  draw();
});

resetButton.addEventListener('click', () => {
  camera = makeCamera();
  draw();
});

draw();
