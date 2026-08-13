// Primality testing over bigint, since the integers named by the view grow
// without bound as the user zooms in (origin doubles on every zoom-in step).

const SMALL_PRIMES: readonly bigint[] = [
  2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n,
];

// Deterministic Miller-Rabin witnesses. This set is proven correct for all
// n < 3,317,044,064,679,887,385,961,981 (~2^121), which covers many zoom
// levels. Beyond that we fall back to extra random rounds, which is
// probabilistic but has a negligible error rate for a visualization.
const DETERMINISTIC_WITNESSES: readonly bigint[] = [
  2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n,
];
const DETERMINISTIC_LIMIT = 3317044064679887385961981n;
const EXTRA_RANDOM_ROUNDS = 20;

function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
  if (modulus === 1n) return 0n;
  let result = 1n;
  let b = base % modulus;
  let e = exponent;
  while (e > 0n) {
    if (e & 1n) {
      result = (result * b) % modulus;
    }
    b = (b * b) % modulus;
    e >>= 1n;
  }
  return result;
}

function isWitness(n: bigint, d: bigint, r: bigint, witness: bigint): boolean {
  let x = modPow(witness, d, n);
  if (x === 1n || x === n - 1n) return false;
  for (let i = 1n; i < r; i++) {
    x = (x * x) % n;
    if (x === n - 1n) return false;
  }
  return true; // n is definitely composite
}

function randomBigIntInRange(min: bigint, max: bigint): bigint {
  const range = max - min;
  const bits = range.toString(2).length;
  const bytes = Math.ceil(bits / 8);
  let value: bigint;
  do {
    const buf = new Uint8Array(bytes);
    crypto.getRandomValues(buf);
    value = 0n;
    for (const byte of buf) {
      value = (value << 8n) | BigInt(byte);
    }
    value &= (1n << BigInt(bits)) - 1n;
  } while (value > range);
  return min + value;
}

/** Returns true if `n` is prime. `n` must be >= 0. */
export function isPrime(n: bigint): boolean {
  if (n < 2n) return false;
  for (const p of SMALL_PRIMES) {
    if (n === p) return true;
    if (n % p === 0n) return false;
  }

  let d = n - 1n;
  let r = 0n;
  while (d % 2n === 0n) {
    d /= 2n;
    r++;
  }

  for (const witness of DETERMINISTIC_WITNESSES) {
    if (witness >= n) continue;
    if (isWitness(n, d, r, witness)) return false;
  }

  if (n >= DETERMINISTIC_LIMIT) {
    for (let i = 0; i < EXTRA_RANDOM_ROUNDS; i++) {
      const witness = randomBigIntInRange(2n, n - 2n);
      if (isWitness(n, d, r, witness)) return false;
    }
  }

  return true;
}
