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

// --- Pan: pointer drag, in units of the canvas's own displayed size so it
// tracks the finger/cursor 1:1 regardless of CSS scaling. ---

let dragPointerId: number | null = null;
let lastClientX = 0;

canvas.addEventListener('pointerdown', (event) => {
  dragPointerId = event.pointerId;
  lastClientX = event.clientX;
  canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener('pointermove', (event) => {
  if (dragPointerId !== event.pointerId) return;
  const rect = canvas.getBoundingClientRect();
  const dxCanvasPixels = ((event.clientX - lastClientX) / rect.width) * renderer.canvasSize;
  lastClientX = event.clientX;

  // Content follows the pointer: dragging right reveals lower origins.
  const dFrac = -dxCanvasPixels / (renderer.canvasSize / 2);
  camera = panBy(camera, dFrac);
  draw();
});

function endDrag(event: PointerEvent): void {
  if (dragPointerId !== event.pointerId) return;
  dragPointerId = null;
}

canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

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
