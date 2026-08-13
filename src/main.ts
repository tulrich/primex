import {makeCamera, panBy, zoomBy, MIN_ORIGIN, MIN_BOTTOM_GEN, type Camera} from './camera';
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
    Drag to pan. Scroll or pinch to zoom.
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

// --- Pan/zoom via pointer events: one active pointer drags (pan only);
// two active pointers pinch (pan follows the midpoint, zoom follows the
// change in distance between them). Everything's tracked in units of the
// canvas's own pixel size so it's independent of CSS scaling. ---

const activePointers = new Map<number, {x: number; y: number}>();
let dragPointerId: number | null = null;
let lastDragX = 0;
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
    lastDragX = activePointers.get(pointerId)!.x;
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
      camera = zoomBy(camera, Math.log2(dist / pinchLastDist));
      const dxCanvasPixels = (midX - pinchLastMidX) * canvasPixelsPerCssPixel;
      camera = panBy(camera, -dxCanvasPixels / (renderer.canvasSize / 2));
    }
    pinchLastDist = dist;
    pinchLastMidX = midX;
    draw();
    return;
  }

  if (dragPointerId === event.pointerId) {
    const dxCanvasPixels = (event.clientX - lastDragX) * canvasPixelsPerCssPixel;
    lastDragX = event.clientX;
    // Content follows the pointer: dragging right reveals lower origins.
    camera = panBy(camera, -dxCanvasPixels / (renderer.canvasSize / 2));
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
    camera = zoomBy(camera, -event.deltaY * ZOOM_SPEED);
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
