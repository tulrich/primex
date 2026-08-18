import {
  makeCamera,
  panBy,
  zoomAtAnchor,
  dampPanDelta,
  dampZoomDelta,
  MIN_ORIGIN,
  MIN_BOTTOM_GEN,
  MAX_BOTTOM_GEN,
  type Camera,
} from './camera';
import {CameraRenderer, type Selection} from './view';
import {isPrime} from './primes';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('missing #app root');

app.innerHTML = `
  <h1>primex<span class="tagline"> - exploring the prime numbers</span></h1>
  <div id="canvas-wrap"><canvas id="view"></canvas></div>
  <div id="readout"></div>
  <div id="selected"></div>
  <div id="controls">
    <button id="reset">Reset</button>
  </div>
  <p id="help">Drag to explore.</p>
  <p id="footer"><a href="https://github.com/tulrich/primex" target="_blank" rel="noopener">View on GitHub</a></p>
`;

const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
const readout = document.querySelector<HTMLDivElement>('#readout')!;
const selectedEl = document.querySelector<HTMLDivElement>('#selected')!;
const resetButton = document.querySelector<HTMLButtonElement>('#reset')!;
const ctx = canvas.getContext('2d');
if (!ctx) throw new Error('2d canvas context unavailable');

const renderer = new CameraRenderer();
canvas.width = renderer.canvasSize;
canvas.height = renderer.canvasSize;

// --- URL hash: encodes enough to reproduce the current view so it's
// shareable — read once on load, written back (debounced) whenever the
// view changes. Only origin and the selected prime are encoded, not the
// exact mid-gesture frac/zoomFrac/bottomGen; a shared link reconstructs
// bottomGen from origin's own bit length (origin's "natural" generation),
// which is a reasonable fresh starting point even though the camera
// itself deliberately doesn't derive bottomGen that way during live
// panning (see the note on that in camera.ts). ---

function parseHashOrigin(): bigint | null {
  const raw = new URLSearchParams(location.hash.slice(1)).get('origin');
  if (!raw) return null;
  try {
    const origin = BigInt(raw);
    if (origin < MIN_ORIGIN) return null;
    // A hand-edited URL could otherwise smuggle in an origin far past
    // MAX_BOTTOM_GEN — cameraFromHash derives bottomGen straight from
    // origin's own bit length, bypassing zoomBy's normal clamp, so this
    // has to be checked here instead.
    if (origin.toString(2).length - 1 > MAX_BOTTOM_GEN) return null;
    return origin;
  } catch {
    return null; // Malformed value in a hand-edited or corrupted URL.
  }
}

function cameraFromHash(): Camera {
  const origin = parseHashOrigin();
  if (origin === null) return makeCamera();
  return makeCamera(origin, origin.toString(2).length - 1);
}

function selectionFromHash(): Selection | null {
  const raw = new URLSearchParams(location.hash.slice(1)).get('selected');
  if (!raw) return null;
  try {
    const n = BigInt(raw);
    // Validate primality rather than trust the URL — a hand-edited or
    // stale link shouldn't be able to show a false "selected prime".
    if (n < 2n || !isPrime(n)) return null;
    return {n, gen: n.toString(2).length - 1};
  } catch {
    return null;
  }
}

const HASH_SYNC_DEBOUNCE_MS = 300;
let hashSyncTimer: number | null = null;

function scheduleHashSync(): void {
  if (hashSyncTimer !== null) clearTimeout(hashSyncTimer);
  hashSyncTimer = window.setTimeout(() => {
    hashSyncTimer = null;
    const params = new URLSearchParams();
    params.set('origin', camera.origin.toString());
    if (selected) params.set('selected', selected.n.toString());
    history.replaceState(null, '', '#' + params.toString());
  }, HASH_SYNC_DEBOUNCE_MS);
}

let camera: Camera = cameraFromHash();
let selected: Selection | null = selectionFromHash();

// --- Overscroll: purely a render-time visual, layered on top of an
// unchanged, hard-clamped camera. Grows from whatever dampPanDelta/
// dampZoomDelta absorbed at the boundary (see applyPanRaw/applyZoomRaw),
// decays back to 0 every animation frame regardless of what else is
// happening (see motionTick). ---

let overscrollXPixels = 0;
let overscrollZoomOut = 0;

const MAX_OVERSCROLL_PX = 80;
const MAX_OVERSCROLL_ZOOM = 0.35;

/** Diminishing returns as `current` approaches `max`: full sensitivity near
 * 0, ~0 sensitivity near the cap, and never exceeds it. */
function pullOverscroll(current: number, deltaMagnitude: number, max: number): number {
  const room = Math.max(0, 1 - current / max);
  return Math.min(max, current + deltaMagnitude * room);
}

/** Decimal digit count, e.g. "1 digit" / "7 digits". */
function digits(n: bigint): string {
  const count = n.toString().length;
  return `${count} digit${count === 1 ? '' : 's'}`;
}

function draw(): void {
  renderer.draw(ctx!, camera, overscrollXPixels, overscrollZoomOut, selected);

  readout.innerHTML =
    `origin ${camera.origin} (${digits(camera.origin)})<br>` +
    `gen ${camera.bottomGen}  ·  frac ${camera.frac.toFixed(3)}  ·  zoomFrac ${camera.zoomFrac.toFixed(3)}`;

  selectedEl.innerHTML = selected
    ? `selected prime:<br><span class="value">${selected.n}</span> (${digits(selected.n)})`
    : '';

  scheduleHashSync();
}

// --- Pan/zoom via pointer events: one active pointer drags — sideways
// pans, up/down zooms, both from the same gesture (drag up = zoom in, to
// match the app's own "up = finer generations" layout). Two active
// pointers pinch instead: pan follows the midpoint, zoom follows the
// change in distance between them. Everything's tracked in units of the
// canvas's own pixel size so it's independent of CSS scaling. ---

/** Applies a raw pan input, growing overscroll from whatever got damped
 * away at the boundary. Returns the delta actually applied to the camera,
 * for velocity tracking. */
function applyPanRaw(dFracRaw: number): number {
  const dFracDamped = dampPanDelta(camera, dFracRaw);
  camera = panBy(camera, dFracDamped);
  const lost = dFracRaw - dFracDamped;
  if (lost < 0) {
    const lostPixels = -lost * (renderer.canvasSize / 2);
    overscrollXPixels = pullOverscroll(overscrollXPixels, lostPixels, MAX_OVERSCROLL_PX);
  }
  return dFracDamped;
}

/** Same idea for zoom, about `anchorFracX` (0 = left edge, 1 = right) so
 * whatever sits under the cursor/fingers stays put as the view scales. */
function applyZoomRaw(dZoomRaw: number, anchorFracX: number): number {
  const dZoomDamped = dampZoomDelta(camera, dZoomRaw);
  if (dZoomDamped !== 0) {
    camera = zoomAtAnchor(camera, dZoomDamped, Math.min(1, Math.max(0, anchorFracX)));
  }
  const lost = dZoomRaw - dZoomDamped;
  if (lost < 0) {
    overscrollZoomOut = pullOverscroll(overscrollZoomOut, -lost, MAX_OVERSCROLL_ZOOM);
  }
  return dZoomDamped;
}

/** Vertical drag distance, in canvas pixels, worth one full generation. */
const ZOOM_DRAG_PIXELS = 256;

const activePointers = new Map<number, {x: number; y: number}>();
let dragPointerId: number | null = null;
let lastDragX = 0;
let lastDragY = 0;
let pinchLastDist = 0;
let pinchLastMidX = 0;
let lastGestureTimestamp = 0;

// --- Tap-to-select: a "tap" is a single pointer that barely moved between
// down and up (not a drag, not part of a pinch). Selection is tracked as
// (n, gen) rather than a screen position — see Selection in view.ts — so
// it stays correctly placed as the camera moves on its own. ---

const TAP_MOVE_THRESHOLD_PX = 8;
let tapPointerId: number | null = null;
let tapStartX = 0;
let tapStartY = 0;
let tapDisqualified = false;

// --- Velocity + inertia: an exponential moving average of applied motion
// per millisecond, fed by every pointermove (drag or pinch alike), and
// consumed by the always-running motion loop once all pointers lift. ---

let panVelocity = 0; // dFrac per ms
let zoomVelocity = 0; // dZoom per ms
let velocityAnchorFracX = 0.5;
const VELOCITY_EMA_ALPHA = 0.35;

function trackVelocity(appliedPan: number, appliedZoom: number, dtMs: number, anchorFracX: number): void {
  if (dtMs <= 0) return;
  const instPan = appliedPan / dtMs;
  const instZoom = appliedZoom / dtMs;
  panVelocity += (instPan - panVelocity) * VELOCITY_EMA_ALPHA;
  zoomVelocity += (instZoom - zoomVelocity) * VELOCITY_EMA_ALPHA;
  velocityAnchorFracX = anchorFracX;
}

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
  // A deliberate touch always stops any ongoing fling, same as a real
  // touchscreen — the motion loop also gates on activePointers being
  // empty, but zeroing here means a tap-without-moving doesn't resume it.
  panVelocity = 0;
  zoomVelocity = 0;

  activePointers.set(event.pointerId, {x: event.clientX, y: event.clientY});
  beginGesture(event.pointerId);
  lastGestureTimestamp = event.timeStamp;

  if (activePointers.size === 1) {
    tapPointerId = event.pointerId;
    tapStartX = event.clientX;
    tapStartY = event.clientY;
    tapDisqualified = false;
  } else {
    // A second pointer means this gesture is a pinch, never a tap.
    tapDisqualified = true;
  }
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

  const dt = event.timeStamp - lastGestureTimestamp;
  lastGestureTimestamp = event.timeStamp;

  const rect = canvas.getBoundingClientRect();
  const canvasPixelsPerCssPixel = renderer.canvasSize / rect.width;

  if (activePointers.size >= 2) {
    const {dist, midX} = pinchMetrics();
    const anchorFracX = (midX - rect.left) / rect.width;
    let appliedPan = 0;
    let appliedZoom = 0;
    if (pinchLastDist > 0) {
      appliedZoom = applyZoomRaw(Math.log2(dist / pinchLastDist), anchorFracX);
      const dxCanvasPixels = (midX - pinchLastMidX) * canvasPixelsPerCssPixel;
      appliedPan = applyPanRaw(-dxCanvasPixels / (renderer.canvasSize / 2));
    }
    pinchLastDist = dist;
    pinchLastMidX = midX;
    trackVelocity(appliedPan, appliedZoom, dt, anchorFracX);
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
    //
    // Zoom anchor is fixed at center (0.5), NOT the live cursor X: that X
    // is simultaneously driving the pan above, so anchoring zoom to it
    // would make zoomAtAnchor's own pan-to-preserve-the-anchor compound
    // with the explicit pan every frame — any vertical motion during an
    // otherwise-horizontal drag (inevitable off-center, even from tiny
    // jitter) would inject a second, coupled horizontal drift. Pinch's
    // anchor is the midpoint of two fingers, a real independent
    // reference, so it doesn't have this problem and stays live.
    const appliedPan = applyPanRaw(-dxCanvasPixels / (renderer.canvasSize / 2));
    const appliedZoom = applyZoomRaw(dyCanvasPixels / ZOOM_DRAG_PIXELS, 0.5);
    trackVelocity(appliedPan, appliedZoom, dt, 0.5);
    draw();
  }
});

function releasePointer(event: PointerEvent): void {
  if (
    event.pointerId === tapPointerId &&
    !tapDisqualified &&
    Math.hypot(event.clientX - tapStartX, event.clientY - tapStartY) <= TAP_MOVE_THRESHOLD_PX
  ) {
    const rect = canvas.getBoundingClientRect();
    const canvasX = (event.clientX - rect.left) * (renderer.canvasSize / rect.width);
    const canvasY = (event.clientY - rect.top) * (renderer.canvasSize / rect.height);
    selected = renderer.hitTest(camera, canvasX, canvasY, overscrollXPixels, overscrollZoomOut);
    draw();
  }
  tapPointerId = null;

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
    panVelocity = 0;
    zoomVelocity = 0;
    const rect = canvas.getBoundingClientRect();
    // Scroll up = zoom in, the usual desktop convention. (Deliberately the
    // opposite sense from vertical drag, which follows the finger instead.)
    applyZoomRaw(-event.deltaY * ZOOM_SPEED, (event.clientX - rect.left) / rect.width);
    draw();
  },
  {passive: false},
);

resetButton.addEventListener('click', () => {
  panVelocity = 0;
  zoomVelocity = 0;
  overscrollXPixels = 0;
  overscrollZoomOut = 0;
  camera = makeCamera();
  selected = null;
  draw();
});

// --- Motion loop: always running. Applies decaying inertia once all
// pointers have lifted, and decays overscroll back to 0 unconditionally
// (so it springs back even mid-drag, e.g. dragging away from the edge). ---

const FRAME_MS_REF = 1000 / 60;
const PAN_VELOCITY_DECAY = 0.94;
const ZOOM_VELOCITY_DECAY = 0.94;
const OVERSCROLL_DECAY = 0.82;
const MIN_PAN_VELOCITY = 0.00003;
const MIN_ZOOM_VELOCITY = 0.00003;
const MIN_OVERSCROLL_PX = 0.3;
const MIN_OVERSCROLL_ZOOM = 0.001;
const SNAP_EPSILON = 0.001;
// Combined pan+zoom speed (same units/scale, see panVelocity/zoomVelocity
// above) below which the snap bias is at full strength, and above which
// it's fully off — ramped smoothly in between so it never fights a fling.
const SNAP_VELOCITY_FULL = 0.00006;
const SNAP_VELOCITY_ZERO = 0.0006;
// Per-axis proximity-based ease strength (fraction of remaining distance
// closed per ~frame): a plateau at full strength within SNAP_STRONG_
// PROXIMITY of a boundary — strong enough to visibly converge over a
// second or so even completely at rest — tapering linearly down to a
// bare nudge by SNAP_WEAK_PROXIMITY, weak enough there that it never
// starts a stationary point moving on its own; it only becomes
// noticeable piggybacking on drift that's already happening.
const SNAP_STRONG_PROXIMITY = 1 / 6;
const SNAP_WEAK_PROXIMITY = 1 / 3;
const SNAP_STRONG_STRENGTH = 0.08;
const SNAP_WEAK_STRENGTH = 0.004;

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function distToNearestBoundary(x: number): number {
  return Math.min(x, 1 - x);
}

function proximityStrength(dist: number): number {
  if (dist <= SNAP_STRONG_PROXIMITY) return SNAP_STRONG_STRENGTH;
  if (dist >= SNAP_WEAK_PROXIMITY) return 0;
  const t = (dist - SNAP_STRONG_PROXIMITY) / (SNAP_WEAK_PROXIMITY - SNAP_STRONG_PROXIMITY);
  return SNAP_STRONG_STRENGTH + (SNAP_WEAK_STRENGTH - SNAP_STRONG_STRENGTH) * t;
}

// Weak-zone bias (1/8-1/4) only assists motion that's already happening —
// it's gated on that axis's velocity being nonzero, i.e. still mid-decay
// — so a point sitting fully at rest just outside the strong zone never
// starts drifting purely from the bias itself ("not enough to move on
// its own"). Inside the strong zone it applies unconditionally, so a
// point that comes to rest there still slowly converges on the vertex.
function snapStrength(dist: number, axisVelocity: number): number {
  if (dist <= SNAP_STRONG_PROXIMITY) return SNAP_STRONG_STRENGTH;
  return axisVelocity !== 0 ? proximityStrength(dist) : 0;
}

let lastMotionTimestamp = performance.now();

function motionTick(t: number): void {
  const dt = Math.min(48, t - lastMotionTimestamp); // cap dt (e.g. after tab switch)
  lastMotionTimestamp = t;
  const frames = dt / FRAME_MS_REF;

  let changed = false;

  // Inertia only applies while no pointer is active — during a live drag,
  // pointermove already applies motion directly, at full responsiveness.
  if (activePointers.size === 0) {
    if (Math.abs(panVelocity) > MIN_PAN_VELOCITY) {
      // Check the boundary BEFORE applying: if we're already resting at
      // the root and still pushing into it, this hit absorbs into
      // overscroll once (applyPanRaw) and then kills velocity outright,
      // rather than let it decay naturally over many more frames while
      // re-triggering overscroll growth each tick — that's what read as
      // "overshoots and rests slightly positive instead of at the
      // border": overscroll's own decay (0.82/frame) is faster than
      // velocity's (0.94/frame), so leftover velocity kept re-feeding a
      // small amount back in every frame, faster than it could settle.
      const pushingIntoRoot = camera.origin <= MIN_ORIGIN && panVelocity < 0;
      applyPanRaw(panVelocity * dt);
      panVelocity = pushingIntoRoot ? 0 : panVelocity * PAN_VELOCITY_DECAY ** frames;
      changed = true;
    } else if (panVelocity !== 0) {
      panVelocity = 0;
    }

    if (Math.abs(zoomVelocity) > MIN_ZOOM_VELOCITY) {
      const pushingIntoMinZoom = camera.bottomGen <= MIN_BOTTOM_GEN && zoomVelocity < 0;
      const pushingIntoMaxZoom = camera.bottomGen >= MAX_BOTTOM_GEN && zoomVelocity > 0;
      applyZoomRaw(zoomVelocity * dt, velocityAnchorFracX);
      zoomVelocity = pushingIntoMinZoom || pushingIntoMaxZoom ? 0 : zoomVelocity * ZOOM_VELOCITY_DECAY ** frames;
      changed = true;
    } else if (zoomVelocity !== 0) {
      zoomVelocity = 0;
    }

    // Gentle bias toward landing on a clean cell/generation boundary
    // (frac and zoomFrac both at 0, i.e. no partial cells anywhere in the
    // frame and no fractional scale) — separate from velocity-based
    // inertia, an exponential ease toward whichever of {0, 1} is nearer.
    // Ramped fully off during medium/fast motion so it never fights a
    // fling, only showing up in the slow tail; strength beyond that is
    // driven per-axis by proximity (see proximityStrength) rather than a
    // hard on/off gate, and pan/zoom are evaluated independently — a
    // pure horizontal pan should still get pulled toward a pan boundary
    // even while zoomFrac sits wherever it was left, not just when both
    // happen to be close at once. Anchored at a fixed center (0.5) for
    // zoom since this isn't tied to any cursor position.
    const speed = Math.hypot(panVelocity, zoomVelocity);
    const velocityRamp = 1 - smoothstep(SNAP_VELOCITY_FULL, SNAP_VELOCITY_ZERO, speed);

    if (velocityRamp > 0) {
      const panTarget = camera.frac < 0.5 ? 0 : 1;
      const panRemaining = panTarget - camera.frac;
      const panStrength = snapStrength(distToNearestBoundary(camera.frac), panVelocity);
      if (panStrength > 0 && Math.abs(panRemaining) > SNAP_EPSILON) {
        applyPanRaw(panRemaining * velocityRamp * (1 - (1 - panStrength) ** frames));
        changed = true;
      }

      const zoomTarget = camera.zoomFrac < 0.5 ? 0 : 1;
      const zoomRemaining = zoomTarget - camera.zoomFrac;
      const zoomStrength = snapStrength(distToNearestBoundary(camera.zoomFrac), zoomVelocity);
      if (zoomStrength > 0 && Math.abs(zoomRemaining) > SNAP_EPSILON) {
        applyZoomRaw(zoomRemaining * velocityRamp * (1 - (1 - zoomStrength) ** frames), 0.5);
        changed = true;
      }
    }
  }

  if (overscrollXPixels > MIN_OVERSCROLL_PX) {
    overscrollXPixels *= OVERSCROLL_DECAY ** frames;
    changed = true;
  } else if (overscrollXPixels !== 0) {
    overscrollXPixels = 0;
    changed = true;
  }

  if (overscrollZoomOut > MIN_OVERSCROLL_ZOOM) {
    overscrollZoomOut *= OVERSCROLL_DECAY ** frames;
    changed = true;
  } else if (overscrollZoomOut !== 0) {
    overscrollZoomOut = 0;
    changed = true;
  }

  if (changed) draw();
  requestAnimationFrame(motionTick);
}

draw();
requestAnimationFrame(motionTick);
