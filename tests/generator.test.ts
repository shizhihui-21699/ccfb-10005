import { describe, expect, it } from 'vitest';
import { generateDataset } from '../src/lib/data/generator';

describe('demo dataset generator', () => {
  it('generates 200k rows deterministically with labelled rings', () => {
    const t0 = performance.now();
    const ds = generateDataset({ n: 200_000, seed: 42 });
    const ms = performance.now() - t0;
    expect(ds.summary.n).toBe(200_000);
    expect(ds.summary.rings.length).toBe(5);
    expect(ds.summary.fraudulent).toBeGreaterThan(2000);
    expect(ds.summary.fraudulent).toBeLessThan(20000);
    expect(ds.cols.floats.ts[0]).toBeLessThanOrEqual(ds.cols.floats.ts[1]);
    console.log('gen ms', Math.round(ms), ds.summary.rings.map((r) => `${r.name}:${r.txns}`).join(', '), 'fraud', ds.summary.fraudulent);
  });

  it('same seed produces identical aggregates', () => {
    const a = generateDataset({ n: 20_000, seed: 7 });
    const b = generateDataset({ n: 20_000, seed: 7 });
    expect(a.summary.totalAmountUsd).toBe(b.summary.totalAmountUsd);
    expect(a.cols.cats.card_hash.dict).toEqual(b.cols.cats.card_hash.dict);
  });
});
