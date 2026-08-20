import {describe, expect, it} from 'vitest';
import {computeFacts} from './primeFacts';

function ids(n: bigint): string[] {
  return computeFacts(n).map((f) => f.id);
}

describe('computeFacts', () => {
  it('2: the only even prime, and a Sophie Germain prime (2*2+1=5 is prime)', () => {
    expect(ids(2n)).toEqual(['only-even-prime', 'sophie-germain-prime']);
    const sg = computeFacts(2n).find((f) => f.id === 'sophie-germain-prime')!;
    expect(sg.related).toEqual([5n]);
  });

  it('5: rich case — Pythagorean, twin (both sides), sexy, Sophie Germain, safe, Fermat', () => {
    expect(ids(5n)).toEqual([
      'pythagorean-prime',
      'twin-prime',
      'sexy-prime',
      'sophie-germain-prime',
      'safe-prime',
      'fermat-prime',
    ]);
    const twin = computeFacts(5n).find((f) => f.id === 'twin-prime')!;
    expect(twin.related).toEqual([3n, 7n]);
  });

  it('7: Blum prime, twin, cousin (both sides), sexy, safe, Mersenne', () => {
    expect(ids(7n)).toEqual(['blum-prime', 'twin-prime', 'cousin-prime', 'sexy-prime', 'safe-prime', 'mersenne-prime']);
    const cousin = computeFacts(7n).find((f) => f.id === 'cousin-prime')!;
    expect(cousin.related).toEqual([3n, 11n]);
  });

  it('13: Pythagorean, twin, cousin, sexy (both sides), emirp (31)', () => {
    expect(ids(13n)).toEqual(['pythagorean-prime', 'twin-prime', 'cousin-prime', 'sexy-prime', 'emirp']);
    const emirp = computeFacts(13n).find((f) => f.id === 'emirp')!;
    expect(emirp.related).toEqual([31n]);
  });

  it('131: Blum, cousin, sexy, Sophie Germain, palindrome (not emirp, since it is a palindrome)', () => {
    expect(ids(131n)).toEqual(['blum-prime', 'cousin-prime', 'sexy-prime', 'sophie-germain-prime', 'palindromic-prime']);
  });

  it('single-digit primes never claim palindrome or emirp', () => {
    for (const n of [2n, 3n, 5n, 7n]) {
      const factIds = ids(n);
      expect(factIds).not.toContain('palindromic-prime');
      expect(factIds).not.toContain('emirp');
    }
  });

  it('every prime gets exactly one of the three mod-4 / even classifications', () => {
    for (const n of [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 131n, 997n]) {
      const modFacts = ids(n).filter((id) =>
        ['only-even-prime', 'pythagorean-prime', 'blum-prime'].includes(id),
      );
      expect(modFacts).toHaveLength(1);
    }
  });

  it('a deep (100+ digit) prime still resolves without throwing', () => {
    // 10^100 + 267 is prime (a known example).
    const deep = 10n ** 100n + 267n;
    const facts = computeFacts(deep);
    expect(facts.length).toBeGreaterThan(0);
  });

  it('every fact has a color and a ring depth', () => {
    for (const n of [2n, 5n, 7n, 13n, 131n]) {
      for (const fact of computeFacts(n)) {
        expect(fact.color).toMatch(/^#[0-9a-f]{6}$/i);
        expect(fact.depth).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('every fact id maps to exactly one depth/color, consistently across primes', () => {
    // A given category should always render the same way regardless of
    // which prime it's attached to -- ring color/depth is a property of
    // the CATEGORY, not of the specific number.
    const seen = new Map<string, {color: string; depth: number}>();
    for (const n of [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 31n, 131n, 137n]) {
      for (const fact of computeFacts(n)) {
        const prior = seen.get(fact.id);
        if (prior) {
          expect(fact.color).toBe(prior.color);
          expect(fact.depth).toBe(prior.depth);
        } else {
          seen.set(fact.id, {color: fact.color, depth: fact.depth});
        }
      }
    }
    expect(seen.size).toBeGreaterThan(5); // sanity: the sweep hit a real variety of categories
  });

  it('mutually exclusive facts share a depth, since they never co-occur', () => {
    const byId = (n: bigint, id: string) => computeFacts(n).find((f) => f.id === id);
    // The mod-4/even trio: check the depth is consistent across all three
    // by finding one example prime for each.
    const evenFact = byId(2n, 'only-even-prime')!;
    const pythagoreanFact = byId(5n, 'pythagorean-prime')!;
    const blumFact = byId(7n, 'blum-prime')!;
    expect(pythagoreanFact.depth).toBe(evenFact.depth);
    expect(blumFact.depth).toBe(evenFact.depth);
    // Palindrome/emirp: 131 is a palindrome, 13 is an emirp (reverses to 31).
    const palindromeFact = byId(131n, 'palindromic-prime')!;
    const emirpFact = byId(13n, 'emirp')!;
    expect(emirpFact.depth).toBe(palindromeFact.depth);
  });

  it('the nine independently-co-occurring categories all get distinct depths', () => {
    // Unlike the mutually-exclusive groups above, these CAN all apply to
    // the same prime at once, so each needs its own ring position.
    const independentIds = [
      'twin-prime',
      'cousin-prime',
      'sexy-prime',
      'sophie-germain-prime',
      'safe-prime',
      'mersenne-prime',
      'fermat-prime',
    ];
    // Pull one example fact per id from a sweep, then confirm depths differ.
    const depths = new Map<string, number>();
    for (const n of [5n, 7n, 13n, 89n, 131n, 137n]) {
      for (const fact of computeFacts(n)) {
        if (independentIds.includes(fact.id)) depths.set(fact.id, fact.depth);
      }
    }
    const values = [...depths.values()];
    expect(new Set(values).size).toBe(values.length); // all distinct
  });
});
