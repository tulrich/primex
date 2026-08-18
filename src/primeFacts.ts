// Classifies a known prime into interesting categories for the education
// panel. Callers already know `n` is prime (from a tap or a hash restore) —
// these functions don't re-verify that.

import {isPrime} from './primes';

export interface PrimeFact {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly wikipediaUrl: string;
  /** Other integers this fact is about — highlighted on screen if visible. */
  readonly related: readonly bigint[];
}

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
      description:
        'Every other even number is divisible by 2, so 2 is the sole exception — the "oddest" prime, in a sense.',
      wikipediaUrl: 'https://en.wikipedia.org/wiki/Prime_number',
      related: [],
    });
  } else if (n % 4n === 1n) {
    facts.push({
      id: 'pythagorean-prime',
      label: 'Pythagorean prime',
      description:
        'Primes that are 1 more than a multiple of 4 can always be written as a sum of two squares (Fermat’s theorem on sums of two squares) — e.g. 13 = 2² + 3².',
      wikipediaUrl: 'https://en.wikipedia.org/wiki/Pythagorean_prime',
      related: [],
    });
  } else {
    facts.push({
      id: 'blum-prime',
      label: 'Blum prime (≡ 3 mod 4)',
      description:
        'Primes that are 3 more than a multiple of 4 can never be written as a sum of two squares. Pairs of them are used to build the Blum Blum Shub random-number generator and the Rabin cryptosystem.',
      wikipediaUrl: 'https://en.wikipedia.org/wiki/Blum_prime',
      related: [],
    });
  }

  // --- Twin / cousin / sexy primes: pairs a fixed small distance apart.
  const pairFact = (id: string, label: string, gap: bigint, description: string, wikipediaUrl: string): void => {
    const related: bigint[] = [];
    if (n - gap >= 2n && isPrime(n - gap)) related.push(n - gap);
    if (isPrime(n + gap)) related.push(n + gap);
    if (related.length > 0) facts.push({id, label, description, wikipediaUrl, related});
  };
  pairFact(
    'twin-prime',
    'Twin prime',
    2n,
    'Part of a pair of primes exactly 2 apart. Whether infinitely many twin primes exist is one of the oldest open problems in number theory.',
    'https://en.wikipedia.org/wiki/Twin_prime',
  );
  pairFact(
    'cousin-prime',
    'Cousin prime',
    4n,
    'Part of a pair of primes exactly 4 apart.',
    'https://en.wikipedia.org/wiki/Cousin_prime',
  );
  pairFact(
    'sexy-prime',
    'Sexy prime',
    6n,
    'Part of a pair of primes exactly 6 apart (from the Latin "sex" for six).',
    'https://en.wikipedia.org/wiki/Sexy_prime',
  );

  // --- Sophie Germain / safe primes: p and 2p+1 are both prime.
  const twicePlusOne = 2n * n + 1n;
  if (isPrime(twicePlusOne)) {
    facts.push({
      id: 'sophie-germain-prime',
      label: 'Sophie Germain prime',
      description:
        '2n + 1 is also prime. Named for the mathematician who used primes like this in early work toward Fermat’s Last Theorem; they’re also used to build cryptographic groups.',
      wikipediaUrl: 'https://en.wikipedia.org/wiki/Safe_and_Sophie_Germain_primes',
      related: [twicePlusOne],
    });
  }
  if (n % 2n === 1n) {
    const halfMinusOne = (n - 1n) / 2n;
    if (halfMinusOne >= 2n && isPrime(halfMinusOne)) {
      facts.push({
        id: 'safe-prime',
        label: 'Safe prime',
        description:
          '(n − 1) / 2 is also prime. Safe primes are the standard choice for the prime modulus in Diffie–Hellman key exchange.',
        wikipediaUrl: 'https://en.wikipedia.org/wiki/Safe_and_Sophie_Germain_primes',
        related: [halfMinusOne],
      });
    }
  }

  // --- Palindromic primes and emirps (digit-string properties).
  if (digits.length > 1 && isPalindrome(digits)) {
    facts.push({
      id: 'palindromic-prime',
      label: 'Palindromic prime',
      description: 'Reads the same forwards and backwards in decimal.',
      wikipediaUrl: 'https://en.wikipedia.org/wiki/Palindromic_prime',
      related: [],
    });
  } else if (digits.length > 1) {
    const reversed = BigInt([...digits].reverse().join(''));
    if (reversed !== n && isPrime(reversed)) {
      facts.push({
        id: 'emirp',
        label: 'Emirp ("prime" spelled backwards)',
        description: 'Reversing its digits gives a different prime.',
        wikipediaUrl: 'https://en.wikipedia.org/wiki/Emirp',
        related: [reversed],
      });
    }
  }

  // --- Mersenne / Fermat primes: named forms tied to powers of two.
  if (isPowerOfTwo(n + 1n)) {
    facts.push({
      id: 'mersenne-prime',
      label: 'Mersenne prime',
      description:
        'Of the form 2ᵏ − 1. These are rare, and finding new ones (via distributed projects like GIMPS) is how the current largest known primes get discovered.',
      wikipediaUrl: 'https://en.wikipedia.org/wiki/Mersenne_prime',
      related: [],
    });
  }
  if (isPowerOfTwo(n - 1n)) {
    const exponent = BigInt((n - 1n).toString(2).length - 1); // n - 1 == 2^exponent
    if (isPowerOfTwo(exponent)) {
      facts.push({
        id: 'fermat-prime',
        label: 'Fermat prime',
        description:
          'Of the form 2^(2ᵏ) + 1. Only five are known to exist (3, 5, 17, 257, 65537) — whether there are any more is still unknown.',
        wikipediaUrl: 'https://en.wikipedia.org/wiki/Fermat_number',
        related: [],
      });
    }
  }

  return facts;
}
