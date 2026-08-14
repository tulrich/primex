import {describe, expect, it} from 'vitest';
import {hitTestAt, selectionScreenRect, canvasSizeForRows, type Selection} from './view';
import {makeCamera, panBy, zoomBy, type Camera} from './camera';

const ROWS = 9;
const SIZE = canvasSizeForRows(ROWS);

describe('hitTestAt / selectionScreenRect round-trip', () => {
  const cameras: Camera[] = [
    makeCamera(),
    panBy(makeCamera(), 0.4),
    zoomBy(makeCamera(), 0.6),
    zoomBy(panBy(zoomBy(makeCamera(), 2.3), 0.7), 0.5),
    {...makeCamera(37n, 6), frac: 0.83, zoomFrac: 0.21},
  ];
  const overscrolls: Array<[number, number]> = [
    [0, 0],
    [15, 0],
    [0, 0.1],
  ];

  it('every prime cell in the visible rows round-trips through its own center', () => {
    let checked = 0;
    for (const camera of cameras) {
      for (const [ox, oz] of overscrolls) {
        // Sweep candidate (n, gen) pairs across the visible row range and,
        // for whichever are actually on-screen and prime, confirm the
        // forward rect's center hits back to the same integer.
        for (let j = 0; j < ROWS; j++) {
          const gen = camera.bottomGen + j;
          const cellCount = 3 * 2 ** j; // BOTTOM_ROW_CELLS(3) * 2^j, mirrors view.ts
          for (let c = 0; c < cellCount; c++) {
            const n = camera.origin * 2n ** BigInt(j) + BigInt(c);
            const selection: Selection = {n, gen};
            const rect = selectionScreenRect(ROWS, SIZE, camera, selection, ox, oz);
            if (!rect) continue; // off-screen for this camera; not an error
            checked++;
            const centerX = rect.x + rect.size / 2;
            const centerY = rect.y + rect.size / 2;
            const hit = hitTestAt(ROWS, SIZE, camera, centerX, centerY, ox, oz);
            if (hit === null) {
              // Only possible if n isn't prime — hitTestAt filters those out.
              continue;
            }
            expect(hit.n).toBe(n);
            expect(hit.gen).toBe(gen);
          }
        }
      }
    }
    // Sanity: the sweep actually exercised a meaningful number of on-screen
    // cells across these cameras, not zero (which would make the loop above
    // vacuously true).
    expect(checked).toBeGreaterThan(100);
  });
});

describe('hitTestAt against known primality', () => {
  it('at the default view, the bottom row is fully prime (2 and 3)', () => {
    const camera = makeCamera();
    // Bottom row spans canvas y in [size/2, size), split into left half (2)
    // and right half (3).
    const leftHit = hitTestAt(ROWS, SIZE, camera, SIZE * 0.25, SIZE * 0.75, 0, 0);
    const rightHit = hitTestAt(ROWS, SIZE, camera, SIZE * 0.75, SIZE * 0.75, 0, 0);
    expect(leftHit?.n).toBe(2n);
    expect(rightHit?.n).toBe(3n);
  });

  it('a tap on the blank cap row (y < 1px) always misses', () => {
    const camera = makeCamera();
    expect(hitTestAt(ROWS, SIZE, camera, SIZE / 2, 0, 0, 0)).toBeNull();
  });

  it('a tap on a non-prime cell misses (4 is not prime)', () => {
    // After zooming into the left child once, the bottom row is (4, 5).
    const camera = zoomBy(makeCamera(), 1);
    expect(camera.origin).toBe(4n);
    const hit = hitTestAt(ROWS, SIZE, camera, SIZE * 0.25, SIZE * 0.75, 0, 0);
    expect(hit).toBeNull(); // 4 is not prime
    const hit5 = hitTestAt(ROWS, SIZE, camera, SIZE * 0.75, SIZE * 0.75, 0, 0);
    expect(hit5?.n).toBe(5n); // 5 is prime
  });

  it('a tap outside the canvas bounds to the right misses cleanly', () => {
    const camera = makeCamera();
    expect(hitTestAt(ROWS, SIZE, camera, SIZE * 10, SIZE * 0.75, 0, 0)).toBeNull();
  });
});
