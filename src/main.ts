import {render, DEFAULT_SCALE, DEFAULT_ORIGIN, MIN_ORIGIN, canvasSizeForScale, type ViewState} from './view';
import {hitTest, applyNav} from './nav';

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
    Tap the upper-left or upper-right quadrant to zoom in on that half.
    Tap the lower half to zoom out. Tap near the left/right edges to pan.
  </p>
`;

const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
const readout = document.querySelector<HTMLDivElement>('#readout')!;
const zoomOutButton = document.querySelector<HTMLButtonElement>('#zoom-out')!;
const resetButton = document.querySelector<HTMLButtonElement>('#reset')!;
const ctx = canvas.getContext('2d');
if (!ctx) throw new Error('2d canvas context unavailable');

let state: ViewState = {scale: DEFAULT_SCALE, origin: DEFAULT_ORIGIN};

function topRowEnd(s: ViewState): bigint {
  const start = s.origin * 2n ** BigInt(s.scale - 1);
  return start + 2n ** BigInt(s.scale) - 1n;
}

function draw(): void {
  const size = canvasSizeForScale(state.scale);
  canvas.width = size;
  canvas.height = size;
  render(ctx!, state);

  readout.textContent =
    `origin ${state.origin}  ·  scale ${state.scale}  ·  showing ` +
    `${state.origin}–${topRowEnd(state)}`;
  zoomOutButton.disabled = state.origin <= MIN_ORIGIN;
}

function navigate(xFraction: number, yFraction: number): void {
  const zone = hitTest(xFraction, yFraction);
  state = {...state, origin: applyNav(state.origin, zone)};
  draw();
}

canvas.addEventListener('click', (event) => {
  const rect = canvas.getBoundingClientRect();
  const xFraction = (event.clientX - rect.left) / rect.width;
  const yFraction = (event.clientY - rect.top) / rect.height;
  navigate(xFraction, yFraction);
});

zoomOutButton.addEventListener('click', () => navigate(0.5, 1));
resetButton.addEventListener('click', () => {
  state = {scale: DEFAULT_SCALE, origin: DEFAULT_ORIGIN};
  draw();
});

draw();
