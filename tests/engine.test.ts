import { describe, expect, it } from 'vitest';
import { generateDataset } from '../src/lib/data/generator';
import { compileRule } from '../src/lib/dsl/compiler';
import { seedPackage } from '../src/lib/data/seed-rules';
import { runReplay } from '../src/lib/engine/replay';
import { detectRings } from '../src/lib/engine/rings';

const ds = generateDataset({ n: 200_000, seed: 42 });
const pkg = seedPackage();
const compiled = new Map(pkg.rules.map((r) => [r.id, compileRule(r, { lists: new Map(pkg.lists.map((l) => [l.id, l])) })]));

describe('replay engine', () => {
  it('compiles every seed rule', () => {
    for (const c of compiled.values()) {
      expect(c.ok, `${c.rule.id}: ${c.diagnostics.map((d) => d.message).join('; ')}`).toBe(true);
    }
  });

  it('replays 200k rows quickly and finds meaningful hits', () => {
    const t0 = performance.now();
    const summary = runReplay({ package: pkg, compiled, columns: ds.cols, truth: ds.truth, explainSample: 200 });
    const ms = performance.now() - t0;
    console.log('replay', ms.toFixed(0), 'ms', summary.rowsPerSecond, 'rows/s',
      'hits', summary.totalHits, 'precision', summary.precision.toFixed(3), 'recall', summary.recall.toFixed(3),
      'FP', summary.falsePositives, 'samples', summary.samples.length);
    expect(ms).toBeLessThan(4000);
    expect(summary.processed).toBe(200_000);
    expect(summary.recall).toBeGreaterThan(0.25);
    expect(summary.precision).toBeGreaterThan(0.15);
  });

  it('detects fraud rings that overlap ground truth', () => {
    const t0 = performance.now();
    const analysis = detectRings(ds.cols, ds.truth);
    const ms = performance.now() - t0;
    console.log('rings', ms.toFixed(0), 'ms', 'clusters', analysis.totalClusters, 'top', analysis.rings.slice(0, 8).map((r) => `${r.label}/${r.txns}/${(r.fraudShare * 100).toFixed(0)}%`).join(' | '));
    expect(analysis.rings.length).toBeGreaterThan(0);
    expect(analysis.elapsedMs).toBeLessThan(5000);
    const risky = analysis.rings.filter((r) => r.fraudShare > 0.5);
    expect(risky.length).toBeGreaterThanOrEqual(2);
  });
});

describe('engine behaviours', () => {
  it('whitelist allow short-circuits later blocking rules', async () => {
    const { RuleEngine } = await import('../src/lib/engine/engine');
    const pkg3 = seedPackage();
    pkg3.lists.find((l) => l.id === 'whitelist_customers')!.entries = ['CUST-WHITE'];
    pkg3.rules.push({
      id: 'BLOCK-ALL', name: 'block all', group_id: 'g_stolen', priority: 1, enabled: true,
      mode: 'enforce', rollout: 100, action: 'block', severity: 'high',
      expression: 'amount_usd > 10', reason: '', tags: [], updated_at: 0,
    });
    pkg3.groups.find((g) => g.id === 'g_stolen')!.priority = 2000;
    pkg3.groups.find((g) => g.id === 'g_allow')!.priority = 5000;
    pkg3.rules.push({
      id: 'ALLOW-VIP', name: 'allow vip', group_id: 'g_allow', priority: 1, enabled: true,
      mode: 'enforce', rollout: 100, action: 'allow', severity: 'low',
      expression: 'in_list(customer_id, "whitelist_customers")', reason: '', tags: [], updated_at: 0,
    });
    const lists = new Map(pkg3.lists.map((l) => [l.id, l]));
    const compiled3 = new Map(pkg3.rules.map((r) => [r.id, compileRule(r, { lists })]));
    const engine = new RuleEngine({ ...pkg3, compiled: compiled3 });
    const base = {
      ts: Date.UTC(2026, 2, 1), amount_usd: 999, card_hash: 'C1', device_id: 'D1', ip: '1.1.1.1',
      customer_id: 'CUST-WHITE', phone_hash: 'P1', card_country: 'US', ip_country: 'US',
      merchant_country: 'US', country: 'US', currency: 'USD', channel: 'ecom', mcc: '5411',
      merchant_id: 'M1', merchant_name: 'x', city: 'x', card_bin: '4539', entry_mode: 'token',
      email_hash: 'e', status: 'approved', is_3ds: false, is_new_device: false, hour: 12,
      weekday: 0, customer_tenure_days: 100, card_tenure_days: 100, amount: 999,
    };
    const res = engine.evaluate({ ...base, id: 't1' });
    expect(res.finalAction).toBe('allow');
    const allHits = res.hits.map((h) => h.ruleId);
    // The seed's R000 and the test's ALLOW-VIP are equivalent whitelist rules in
    // the same top-priority group; R000 sorts first, so it short-circuits instead.
    expect(allHits.length).toBe(1);
    expect(allHits[0]).toBe('R000');
    expect(allHits).not.toContain('BLOCK-ALL');
  });

  it('rollout buckets are stable per card', async () => {
    const { inRollout } = await import('../src/lib/engine/engine');
    const rule = { ...seedPackage().rules[0], rollout: 50 };
    const results = new Set<boolean>();
    for (let i = 0; i < 50; i++) {
      results.add(inRollout(rule, { card_hash: 'CARD-X', id: `T${i}` }));
    }
    expect(results.size).toBe(1);
  });
});
