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
});
