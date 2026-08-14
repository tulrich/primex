import {DEFAULT_SCALE, DEFAULT_ORIGIN, MIN_ORIGIN, type ViewState} from './view';
import {hitTest, applyNav} from './nav';
import {Filmstrip} from './filmstrip';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('missing #app root');

app.innerHTML = `
  <h1>primex</h1>
  <div id="canvas-wrap">
    <canvas class="frame"></canvas>
    <canvas class="frame"></canvas>
    <canvas class="frame"></canvas>
  </div>
  <div id="readout"></div>
  <div id="controls">
    <button id="zoom-out">Zoom out</button>
    <button id="reset">Reset</button>
  </div>
  <p id="help">
    Tap the upper-left or upper-right quadrant to zoom in on that half.
    Tap the lower half to zoom out. Drag left or right to pan, or flick for
    momentum.
  </p>
`;

const canvasWrap = document.querySelector<HTMLDivElement>('#canvas-wrap')!;
const frames = Array.from(canvasWrap.querySelectorAll<HTMLCanvasElement>('canvas.frame')) as [
  HTMLCanvasElement,
  HTMLCanvasElement,
  HTMLCanvasElement,
];
const readout = document.querySelector<HTMLDivElement>('#readout')!;
const zoomOutButton = document.querySelector<HTMLButtonElement>('#zoom-out')!;
const resetButton = document.querySelector<HTMLButtonElement>('#reset')!;

const filmstrip = new Filmstrip(frames);

let state: ViewState = {scale: DEFAULT_SCALE, origin: DEFAULT_ORIGIN};

// Drag + inertia tuning. Velocities are in CSS px/ms.
const DRAG_THRESHOLD = 6;
const RUBBER_BAND_RESIST = 120;
const DECAY_PER_MS = 0.006;
const STOP_VELOCITY = 0.05;
const MAX_VELOCITY = 3; // px/ms; guards against huge spikes from tiny sample dt.
const IDLE_VELOCITY_RESET_MS = 60; // a pause before release means "not a flick".
const SETTLE_EASE = 0.22;
const SETTLE_EPSILON = 0.5;
const VELOCITY_SAMPLE_WINDOW = 6;

let activePointerId: number | null = null;
let dragging = false;
let dragStartX = 0;
let dragStartY = 0;
let dragOffsetAtStart = 0;
let offsetPx = 0;
let samples: {t: number; x: number}[] = [];
let animationHandle: number | null = null;

function topRowEnd(s: ViewState): bigint {
  const start = s.origin * 2n ** BigInt(s.scale - 1);
  return start + 2n ** BigInt(s.scale) - 1n;
}

function wrapWidth(): number {
  return canvasWrap.getBoundingClientRect().width;
}

function cancelInertia(): void {
  if (animationHandle !== null) {
    cancelAnimationFrame(animationHandle);
    animationHandle = null;
  }
}

/** Dampens drag distance past the point where further panning is a no-op. */
function rubberBand(dx: number): number {
  return (dx * RUBBER_BAND_RESIST) / (dx + RUBBER_BAND_RESIST);
}

function syncReadout(): void {
  state = {...state, origin: filmstrip.currentOrigin};
  readout.textContent =
    `origin ${state.origin}  ·  scale ${state.scale}  ·  showing ` +
    `${state.origin}–${topRowEnd(state)}`;
  zoomOutButton.disabled = state.origin <= MIN_ORIGIN;
}

function resetTo(next: ViewState): void {
  cancelInertia();
  state = next;
  filmstrip.reset(state);
  offsetPx = 0;
  filmstrip.applyOffset(0);
  syncReadout();
}

function navigate(xFraction: number, yFraction: number): void {
  const zone = hitTest(xFraction, yFraction);
  if (zone === 'pan-left') {
    filmstrip.commitPanLeft();
  } else if (zone === 'pan-right') {
    filmstrip.commitPanRight();
  } else {
    state = {...state, origin: applyNav(state.origin, zone)};
    filmstrip.reset(state);
  }
  offsetPx = 0;
  filmstrip.applyOffset(0);
  syncReadout();
}

function runInertia(initialVelocity: number): void {
  let velocity = initialVelocity;
  let last = performance.now();

  function ease(): void {
    offsetPx *= 1 - SETTLE_EASE;
    if (Math.abs(offsetPx) < SETTLE_EPSILON) {
      offsetPx = 0;
      filmstrip.applyOffset(0);
      syncReadout();
      animationHandle = null;
      return;
    }
    filmstrip.applyOffset(offsetPx);
    animationHandle = requestAnimationFrame(ease);
  }

  function settle(): void {
    const size = wrapWidth();
    if (offsetPx > size / 2) {
      filmstrip.commitPanLeft();
      offsetPx -= size;
    } else if (offsetPx < -size / 2) {
      filmstrip.commitPanRight();
      offsetPx += size;
    }
    ease();
  }

  function step(now: number): void {
    const dt = now - last;
    last = now;
    velocity *= Math.exp(-DECAY_PER_MS * dt);
    offsetPx += velocity * dt;

    const size = wrapWidth();
    while (offsetPx >= size) {
      filmstrip.commitPanLeft();
      offsetPx -= size;
    }
    while (offsetPx <= -size) {
      filmstrip.commitPanRight();
      offsetPx += size;
    }

    if (Math.abs(velocity) < STOP_VELOCITY) {
      settle();
      return;
    }
    filmstrip.applyOffset(offsetPx);
    animationHandle = requestAnimationFrame(step);
  }

  animationHandle = requestAnimationFrame(step);
}

canvasWrap.addEventListener('pointerdown', (event: PointerEvent) => {
  if (activePointerId !== null) return;
  activePointerId = event.pointerId;
  canvasWrap.setPointerCapture(event.pointerId);
  cancelInertia();
  dragging = false;
  dragStartX = event.clientX;
  dragStartY = event.clientY;
  dragOffsetAtStart = offsetPx;
  samples = [{t: performance.now(), x: event.clientX}];
});

canvasWrap.addEventListener('pointermove', (event: PointerEvent) => {
  if (event.pointerId !== activePointerId) return;
  const dx = event.clientX - dragStartX;
  const dy = event.clientY - dragStartY;
  if (!dragging) {
    if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
    if (Math.abs(dy) > Math.abs(dx)) return; // Mostly vertical: leave it as a potential tap.
    dragging = true;
    canvasWrap.style.cursor = 'grabbing';
  }
  samples.push({t: performance.now(), x: event.clientX});
  if (samples.length > VELOCITY_SAMPLE_WINDOW) samples.shift();

  let raw = dragOffsetAtStart + dx;
  if (raw > 0 && filmstrip.atLeftBoundary) raw = rubberBand(raw);
  offsetPx = raw;
  filmstrip.applyOffset(offsetPx);
});

canvasWrap.addEventListener('pointerup', (event: PointerEvent) => {
  if (event.pointerId !== activePointerId) return;
  canvasWrap.releasePointerCapture(event.pointerId);
  activePointerId = null;

  if (!dragging) {
    const rect = canvasWrap.getBoundingClientRect();
    const xFraction = (event.clientX - rect.left) / rect.width;
    const yFraction = (event.clientY - rect.top) / rect.height;
    navigate(xFraction, yFraction);
    return;
  }

  dragging = false;
  canvasWrap.style.cursor = '';
  const first = samples[0];
  const last = samples[samples.length - 1];
  const dt = last.t - first.t;
  const idleSinceLastMove = performance.now() - last.t;
  const rawVelocity = dt > 0 && idleSinceLastMove < IDLE_VELOCITY_RESET_MS ? (last.x - first.x) / dt : 0;
  const velocity = Math.max(-MAX_VELOCITY, Math.min(MAX_VELOCITY, rawVelocity));
  runInertia(velocity);
});

canvasWrap.addEventListener('pointercancel', (event: PointerEvent) => {
  if (event.pointerId !== activePointerId) return;
  activePointerId = null;
  dragging = false;
  canvasWrap.style.cursor = '';
  runInertia(0);
});

zoomOutButton.addEventListener('click', () => navigate(0.5, 1));
resetButton.addEventListener('click', () => resetTo({scale: DEFAULT_SCALE, origin: DEFAULT_ORIGIN}));

resetTo(state);
