// Classifies a known prime into interesting categories for the education
// panel. Callers already know `n` is prime (from a tap or a hash restore) —
// these functions don't re-verify that.

import {isPrime} from './primes';

export interface PrimeFact {
  readonly id: string;
  readonly label: string;
  /** One clause, shown inline in the always-visible list. */
  readonly short: string;
  /** The fuller explanation, shown only when this fact is expanded. */
  readonly description: string;
  readonly wikipediaUrl: string;
  /** Other integers this fact is about — highlighted on screen if visible. */
  readonly related: readonly bigint[];
  /** Ring color for the on-screen highlight border. */
  readonly color: string;
  /**
   * Fixed ring position (0 = outermost, right inside the selected-prime's
   * blue border) — an identity of the CATEGORY, not an index into however
   * many facts a given prime happens to have. A prime missing an
   * in-between category leaves a visible gap between its other rings
   * rather than compacting two unrelated categories' rings together,
   * which is what keeps adjacent ring colors distinguishable: two facts
   * only ever render edge-to-edge if their depths are truly consecutive
   * AND both present. See view.ts's ring rendering, and PLAN.md for the
   * palette derivation (colors validated pairwise-adjacent, not all-pairs
   * — this gap-preserving depth scheme is what makes that sufficient).
   */
  readonly depth: number;
}

// Depth 0 is shared by the three mod-4/even facts below since they're
// mutually exclusive (a prime has exactly one) — they never appear
// together, so sharing a depth (and a deliberately muted, low-saturation
// color, unlike the "special club" facts below) is exactly right rather
// than wasting a validated color slot on a pairing that can't occur.
// Depth 8 is likewise shared by palindrome/emirp, which are mutually
// exclusive by construction (see below).
const MOD4_RING = {color: '#6b7280', depth: 0};
const TWIN_RING = {color: '#eb6834', depth: 1};
const COUSIN_RING = {color: '#1baf7a', depth: 2};
const SEXY_RING = {color: '#eda100', depth: 3};
const SOPHIE_GERMAIN_RING = {color: '#e87ba4', depth: 4};
const SAFE_RING = {color: '#008300', depth: 5};
const MERSENNE_RING = {color: '#e34948', depth: 6};
const FERMAT_RING = {color: '#8b2f8b', depth: 7};
const DIGIT_PATTERN_RING = {color: '#00a0a0', depth: 8};

function isPalindrome(digits: string): boolean {
  for (let i = 0, j = digits.length - 1; i < j; i++, j--) {
    if (digits[i] !== digits[j]) return false;
  }
  return true;
}

/** True if `x` (a positive bigint) is an exact power of two. */
function isPowerOfTwo(x: bigint): boolean {
  return x > 0n && (x & (x - 1n)) === 0n;
}

export function computeFacts(n: bigint): PrimeFact[] {
  const facts: PrimeFact[] = [];
  const digits = n.toString();

  // --- The only even prime, or its odd/mod-4 flavor. Every prime falls
  // into exactly one of these three, so there's always at least one fact.
  if (n === 2n) {
    facts.push({
      id: 'only-even-prime',
      label: 'The only even prime',
      short: 'every other even number is divisible by 2',
      description:
        'Every other even number is divisible by 2, so 2 is the sole exception — the "oddest" prime, in a sense.',
      wikipediaUrl: 'https://en.wikipedia.org/wiki/Prime_number',
      related: [],
      ...MOD4_RING,
    });
  } else if (n % 4n === 1n) {
    facts.push({
      id: 'pythagorean-prime',
      label: 'Pythagorean prime',
      short: 'a sum of two squares',
      description:
        'Primes that are 1 more than a multiple of 4 can always be written as a sum of two squares (Fermat’s theorem on sums of two squares) — e.g. 13 = 2² + 3².',
      wikipediaUrl: 'https://en.wikipedia.org/wiki/Pythagorean_prime',
      related: [],
      ...MOD4_RING,
    });
  } else {
    facts.push({
      id: 'blum-prime',
      label: 'Blum prime',
      short: '≡ 3 (mod 4)',
      description:
        'Primes that are 3 more than a multiple of 4 can never be written as a sum of two squares. Pairs of them are used to build the Blum Blum Shub random-number generator and the Rabin cryptosystem.',
      wikipediaUrl: 'https://en.wikipedia.org/wiki/Blum_prime',
      related: [],
      ...MOD4_RING,
    });
  }

  // --- Twin / cousin / sexy primes: pairs a fixed small distance apart.
  const pairFact = (
    id: string,
    label: string,
    gap: bigint,
    short: string,
    description: string,
    wikipediaUrl: string,
    ring: {color: string; depth: number},
  ): void => {
    const related: bigint[] = [];
    if (n - gap >= 2n && isPrime(n - gap)) related.push(n - gap);
    if (isPrime(n + gap)) related.push(n + gap);
    if (related.length > 0) facts.push({id, label, short, description, wikipediaUrl, related, ...ring});
  };
  pairFact(
    'twin-prime',
    'Twin prime',
    2n,
    'part of a pair exactly 2 apart',
    'Part of a pair of primes exactly 2 apart. Whether infinitely many twin primes exist is one of the oldest open problems in number theory.',
    'https://en.wikipedia.org/wiki/Twin_prime',
    TWIN_RING,
  );
  pairFact(
    'cousin-prime',
    'Cousin prime',
    4n,
    'part of a pair exactly 4 apart',
    'Part of a pair of primes exactly 4 apart.',
    'https://en.wikipedia.org/wiki/Cousin_prime',
    COUSIN_RING,
  );
  pairFact(
    'sexy-prime',
    'Sexy prime',
    6n,
    'part of a pair exactly 6 apart',
    'Part of a pair of primes exactly 6 apart (from the Latin "sex" for six).',
    'https://en.wikipedia.org/wiki/Sexy_prime',
    SEXY_RING,
  );

  // --- Sophie Germain / safe primes: p and 2p+1 are both prime.
  const twicePlusOne = 2n * n + 1n;
  if (isPrime(twicePlusOne)) {
    facts.push({
      id: 'sophie-germain-prime',
      label: 'Sophie Germain prime',
      short: '2n + 1 is also prime',
      description:
        '2n + 1 is also prime. Named for the mathematician who used primes like this in early work toward Fermat’s Last Theorem; they’re also used to build cryptographic groups.',
      wikipediaUrl: 'https://en.wikipedia.org/wiki/Safe_and_Sophie_Germain_primes',
      related: [twicePlusOne],
      ...SOPHIE_GERMAIN_RING,
    });
  }
  if (n % 2n === 1n) {
    const halfMinusOne = (n - 1n) / 2n;
    if (halfMinusOne >= 2n && isPrime(halfMinusOne)) {
      facts.push({
        id: 'safe-prime',
        label: 'Safe prime',
        short: '(n − 1) / 2 is also prime',
        description:
          '(n − 1) / 2 is also prime. Safe primes are the standard choice for the prime modulus in Diffie–Hellman key exchange.',
        wikipediaUrl: 'https://en.wikipedia.org/wiki/Safe_and_Sophie_Germain_primes',
        related: [halfMinusOne],
        ...SAFE_RING,
      });
    }
  }

  // --- Palindromic primes and emirps (digit-string properties, mutually
  // exclusive by construction — a palindrome's reversal equals itself, so
  // it can never also qualify as an emirp, which requires a *different*
  // reversed prime. Share a ring depth/color, same reasoning as the mod-4
  // trio above.
  if (digits.length > 1 && isPalindrome(digits)) {
    facts.push({
      id: 'palindromic-prime',
      label: 'Palindromic prime',
      short: 'reads the same backwards',
      description: 'Reads the same forwards and backwards in decimal.',
      wikipediaUrl: 'https://en.wikipedia.org/wiki/Palindromic_prime',
      related: [],
      ...DIGIT_PATTERN_RING,
    });
  } else if (digits.length > 1) {
    const reversed = BigInt([...digits].reverse().join(''));
    if (reversed !== n && isPrime(reversed)) {
      facts.push({
        id: 'emirp',
        label: 'Emirp',
        short: 'reverses to a different prime',
        description: '"Prime" spelled backwards — reversing its digits gives a different prime.',
        wikipediaUrl: 'https://en.wikipedia.org/wiki/Emirp',
        related: [reversed],
        ...DIGIT_PATTERN_RING,
      });
    }
  }

  // --- Mersenne / Fermat primes: named forms tied to powers of two.
  if (isPowerOfTwo(n + 1n)) {
    facts.push({
      id: 'mersenne-prime',
      label: 'Mersenne prime',
      short: 'of the form 2ᵏ − 1',
      description:
        'Of the form 2ᵏ − 1. These are rare, and finding new ones (via distributed projects like GIMPS) is how the current largest known primes get discovered.',
      wikipediaUrl: 'https://en.wikipedia.org/wiki/Mersenne_prime',
      related: [],
      ...MERSENNE_RING,
    });
  }
  if (isPowerOfTwo(n - 1n)) {
    const exponent = BigInt((n - 1n).toString(2).length - 1); // n - 1 == 2^exponent
    if (isPowerOfTwo(exponent)) {
      facts.push({
        id: 'fermat-prime',
        label: 'Fermat prime',
        short: 'of the form 2^(2ᵏ) + 1',
        description:
          'Of the form 2^(2ᵏ) + 1. Only five are known to exist (3, 5, 17, 257, 65537) — whether there are any more is still unknown.',
        wikipediaUrl: 'https://en.wikipedia.org/wiki/Fermat_number',
        related: [],
        ...FERMAT_RING,
      });
    }
  }

  return facts;
}
