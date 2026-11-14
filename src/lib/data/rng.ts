/** Deterministic, fast PRNG (mulberry32). Same seed → same dataset in every browser. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  private next: () => number;

  constructor(seed: number) {
    this.next = mulberry32(seed);
  }

  float(): number {
    return this.next();
  }

  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  floatRange(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  bool(p = 0.5): boolean {
    return this.next() < p;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }

  /** Box-Muller normal. */
  normal(mean = 0, stddev = 1): number {
    let u = 0;
    let v = 0;
    while (u === 0) u = this.next();
    while (v === 0) v = this.next();
    return mean + stddev * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  lognormal(mu: number, sigma: number): number {
    return Math.exp(this.normal(mu, sigma));
  }

  /** Weighted pick from [weight, value] pairs. */
  weighted<T>(pairs: ReadonlyArray<readonly [number, T]>): T {
    let total = 0;
    for (const [w] of pairs) total += w;
    let r = this.next() * total;
    for (const [w, v] of pairs) {
      r -= w;
      if (r <= 0) return v;
    }
    return pairs[pairs.length - 1][1];
  }

  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
}

/** 32-bit FNV-1a hash, used for deterministic rollout bucketing. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** O(log n) weighted sampler over a fixed weight vector. */
export class WeightedPicker {
  private cumulative: Float64Array;
  private total: number;

  constructor(weights: ArrayLike<number>) {
    this.cumulative = new Float64Array(weights.length);
    let sum = 0;
    for (let i = 0; i < weights.length; i++) {
      sum += weights[i];
      this.cumulative[i] = sum;
    }
    this.total = sum;
  }

  pickIndex(rng: Rng): number {
    const target = rng.float() * this.total;
    let lo = 0;
    let hi = this.cumulative.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.cumulative[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  pick<T>(rng: Rng, items: readonly T[]): T {
    return items[this.pickIndex(rng)];
  }
}
