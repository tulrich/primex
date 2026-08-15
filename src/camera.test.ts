import {describe, expect, it} from 'vitest';
import {
  makeCamera,
  panBy,
  zoomBy,
  zoomAtAnchor,
  worldXAt,
  windowCells,
  dampPanDelta,
  dampZoomDelta,
  MIN_ORIGIN,
  MIN_BOTTOM_GEN,
  type Camera,
} from './camera';

describe('panBy', () => {
  it('accumulates frac without touching origin within a cell', () => {
    const c = panBy(makeCamera(10n), 0.3);
    expect(c.origin).toBe(10n);
    expect(c.frac).toBeCloseTo(0.3);
  });

  it('rebases origin by +1 and wraps frac on rightward overflow', () => {
    const c = panBy({...makeCamera(10n), frac: 0.8}, 0.5);
    expect(c.origin).toBe(11n);
    expect(c.frac).toBeCloseTo(0.3);
  });

  it('rebases origin by -1 and wraps frac on leftward overflow', () => {
    const c = panBy({...makeCamera(10n), frac: 0.2}, -0.5);
    expect(c.origin).toBe(9n);
    expect(c.frac).toBeCloseTo(0.7);
  });

  it('crossing a power-of-2 boundary does not change bottomGen', () => {
    // 3 -> 4 crosses a generation boundary in the true tree, but panning
    // must not be a zoom event.
    const c = panBy({...makeCamera(3n, 5), frac: 0.9}, 0.5);
    expect(c.origin).toBe(4n);
    expect(c.bottomGen).toBe(5);
  });

  it('clamps at the root and stops, not going below MIN_ORIGIN', () => {
    const c = panBy(makeCamera(MIN_ORIGIN), -5);
    expect(c.origin).toBe(MIN_ORIGIN);
    expect(c.frac).toBe(0);
  });

  it('handles multi-cell jumps in one call', () => {
    const c = panBy(makeCamera(10n), 3.4);
    expect(c.origin).toBe(13n);
    expect(c.frac).toBeCloseTo(0.4);
  });
});

describe('zoomBy', () => {
  it('zooming in with frac < 0.5 descends into the left child', () => {
    const c = zoomBy({...makeCamera(10n), frac: 0.2}, 1);
    expect(c.origin).toBe(20n);
    expect(c.frac).toBeCloseTo(0.4);
    expect(c.bottomGen).toBe(MIN_BOTTOM_GEN + 1);
    expect(c.zoomFrac).toBeCloseTo(0);
  });

  it('zooming in with frac >= 0.5 descends into the right child', () => {
    const c = zoomBy({...makeCamera(10n), frac: 0.8}, 1);
    expect(c.origin).toBe(21n);
    expect(c.frac).toBeCloseTo(0.6);
  });

  it('zooming out from an even (left) child halves origin and frac', () => {
    const c = zoomBy({...makeCamera(20n, 5), frac: 0.4}, -1);
    expect(c.origin).toBe(10n);
    expect(c.frac).toBeCloseTo(0.2);
    expect(c.bottomGen).toBe(4);
  });

  it('zooming out from an odd (right) child reconstructs frac with +1', () => {
    const c = zoomBy({...makeCamera(21n, 5), frac: 0.6}, -1);
    expect(c.origin).toBe(10n);
    expect(c.frac).toBeCloseTo(0.8);
    expect(c.bottomGen).toBe(4);
  });

  it('clamps at MIN_BOTTOM_GEN and stops', () => {
    const c = zoomBy(makeCamera(MIN_ORIGIN, MIN_BOTTOM_GEN), -3);
    expect(c.bottomGen).toBe(MIN_BOTTOM_GEN);
    expect(c.zoomFrac).toBe(0);
  });

  it('round-trips: zoom in then immediately back out returns to the start', () => {
    const starts: Camera[] = [
      makeCamera(2n, 1),
      {...makeCamera(123456789n, 40), frac: 0.123},
      {...makeCamera(6n, 3), frac: 0.999},
      {...makeCamera(7n, 3), frac: 0.001},
    ];
    for (const start of starts) {
      const roundTripped = zoomBy(zoomBy(start, 1), -1);
      expect(roundTripped.origin).toBe(start.origin);
      expect(roundTripped.bottomGen).toBe(start.bottomGen);
      expect(roundTripped.frac).toBeCloseTo(start.frac, 9);
      expect(roundTripped.zoomFrac).toBeCloseTo(start.zoomFrac, 9);
    }
  });

  it('multiple whole steps in one call match repeated unit calls', () => {
    const start: Camera = {...makeCamera(5n, 3), frac: 0.42};
    const oneShot = zoomBy(start, 3);
    const stepwise = zoomBy(zoomBy(zoomBy(start, 1), 1), 1);
    expect(oneShot.origin).toBe(stepwise.origin);
    expect(oneShot.bottomGen).toBe(stepwise.bottomGen);
    expect(oneShot.frac).toBeCloseTo(stepwise.frac, 9);
  });
});

describe('worldXAt / zoom continuity', () => {
  // Cameras spanning: the root, mid-cell, either side of the frac=0.5
  // child-choice boundary (where the old renderer flipped its anchor and
  // visibly jumped), and a deeper generation.
  const cameras: Camera[] = [
    makeCamera(MIN_ORIGIN, MIN_BOTTOM_GEN),
    {...makeCamera(5n, 3), frac: 0.25},
    {...makeCamera(5n, 3), frac: 0.499},
    {...makeCamera(5n, 3), frac: 0.501},
    {...makeCamera(37n, 6), frac: 0.8, zoomFrac: 0.4},
  ];

  it('zoomBy leaves the view left edge on the same world point', () => {
    for (const c of cameras) {
      for (const dz of [0.1, 0.5, 0.99, 1, 1.7, -0.3, -1]) {
        const zoomed = zoomBy(c, dz);
        if (zoomed.bottomGen <= MIN_BOTTOM_GEN && dz < 0) continue; // clamped
        expect(worldXAt(zoomed, 0)).toBeCloseTo(worldXAt(c, 0), 12);
      }
    }
  });

  it('panBy shifts the left edge by exactly the requested cell count', () => {
    const c = {...makeCamera(5n, 3), frac: 0.25};
    for (const dp of [0.1, 0.75, 1.5, -0.2]) {
      const expected = worldXAt(c, 0) + dp / 2 ** c.bottomGen;
      expect(worldXAt(panBy(c, dp), 0)).toBeCloseTo(expected, 12);
    }
  });

  it('the window narrows by exactly 2x per generation zoomed in', () => {
    const c = {...makeCamera(5n, 3), frac: 0.25};
    expect(windowCells(c)).toBeCloseTo(2, 12);
    expect(windowCells(zoomBy(c, 1))).toBeCloseTo(2, 12); // rebased: 2 new cells
    // In absolute terms the visible span really did halve.
    const span = (cam: Camera) => worldXAt(cam, 1) - worldXAt(cam, 0);
    expect(span(zoomBy(c, 1))).toBeCloseTo(span(c) / 2, 12);
  });

  it('zoomAtAnchor pins the world point under the anchor', () => {
    for (const c of cameras) {
      for (const anchor of [0, 0.25, 0.5, 0.75, 1]) {
        for (const dz of [0.1, 0.6, 1.3, -0.4]) {
          const zoomed = zoomAtAnchor(c, dz, anchor);
          if (zoomed.bottomGen <= MIN_BOTTOM_GEN && dz < 0) continue; // clamped
          expect(worldXAt(zoomed, anchor)).toBeCloseTo(worldXAt(c, anchor), 12);
        }
      }
    }
  });

  it('zooming across the frac=0.5 child boundary stays continuous', () => {
    // Regression: the renderer used to flip its zoom anchor from the left
    // corner to the right corner at frac=0.5, so two cameras a hair apart
    // rendered from very different transforms — a visible jump mid-drag.
    const below = {...makeCamera(5n, 3), frac: 0.4999, zoomFrac: 0.5};
    const above = {...makeCamera(5n, 3), frac: 0.5001, zoomFrac: 0.5};

    // These two cameras really are 0.0002 cells apart, so the view should
    // differ by exactly that much — and by nothing more. The old bug moved
    // the view by a large fraction of the window across this boundary, so
    // compare the step against the window span rather than to zero.
    const step = Math.abs(worldXAt(above, 0.5) - worldXAt(below, 0.5));
    const span = worldXAt(below, 1) - worldXAt(below, 0);
    expect(step).toBeCloseTo(0.0002 / 2 ** 3, 12);
    expect(step).toBeLessThan(span / 1000);

    // And stepping zoomFrac through the 1.0 rebase is smooth too.
    const justUnder = zoomBy(below, 0.4999);
    const justOver = zoomBy(below, 0.5001);
    expect(worldXAt(justOver, 0)).toBeCloseTo(worldXAt(justUnder, 0), 12);
    expect(justOver.bottomGen).toBe(justUnder.bottomGen + 1); // did rebase
  });
});

describe('dampPanDelta', () => {
  it('passes rightward deltas through unchanged, anywhere', () => {
    expect(dampPanDelta(makeCamera(MIN_ORIGIN), 0.3)).toBe(0.3);
    expect(dampPanDelta({...makeCamera(50n), frac: 0.9}, 0.3)).toBe(0.3);
  });

  it('passes leftward deltas through unchanged away from the root', () => {
    const c = {...makeCamera(50n), frac: 0.4};
    expect(dampPanDelta(c, -0.3)).toBe(-0.3);
  });

  it('damps leftward deltas at the root in proportion to frac', () => {
    const near = dampPanDelta({...makeCamera(MIN_ORIGIN), frac: 0.1}, -0.5);
    const far = dampPanDelta({...makeCamera(MIN_ORIGIN), frac: 0.9}, -0.5);
    expect(near).toBeCloseTo(-0.05, 9); // -0.5 * 0.1
    expect(far).toBeCloseTo(-0.45, 9); // -0.5 * 0.9
    expect(Math.abs(near)).toBeLessThan(Math.abs(far));
  });

  it('goes to exactly zero right at the root edge, never overshooting', () => {
    const atEdge = dampPanDelta(makeCamera(MIN_ORIGIN), -1);
    expect(atEdge).toBeCloseTo(0, 9);
    const result = panBy(makeCamera(MIN_ORIGIN), atEdge);
    expect(result.origin).toBe(MIN_ORIGIN);
    expect(result.frac).toBe(0);
  });
});

describe('dampZoomDelta', () => {
  it('passes zoom-in deltas through unchanged, anywhere', () => {
    expect(dampZoomDelta(makeCamera(MIN_ORIGIN, MIN_BOTTOM_GEN), 0.4)).toBe(0.4);
  });

  it('passes zoom-out deltas through unchanged away from the min generation', () => {
    const c = {...makeCamera(50n, 10), zoomFrac: 0.4};
    expect(dampZoomDelta(c, -0.3)).toBe(-0.3);
  });

  it('damps zoom-out deltas at the min generation in proportion to zoomFrac', () => {
    const c = {...makeCamera(MIN_ORIGIN, MIN_BOTTOM_GEN), zoomFrac: 0.2};
    expect(dampZoomDelta(c, -0.5)).toBeCloseTo(-0.1, 9); // -0.5 * 0.2
  });
});
