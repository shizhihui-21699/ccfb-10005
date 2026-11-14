/// <reference lib="webworker" />
import { generateDataset } from '../data/generator';
import { compileRule, type CompiledRule } from '../dsl/compiler';
import { DEFAULT_RING_PARAMS, detectRings, type RingParameters } from '../engine/rings';
import { RuleEngine } from '../engine/engine';
import { fillRow } from '../data/schema';
import type { Row } from '../data/schema';
import type { Dataset, Columns } from '../data/schema';
import type { RulePackage } from '../types';
import type {
  ReplaySample, ReplaySummary, RuleStats, DecisionBreakdown,
} from '../engine/replay';
import type { WorkerRequest, WorkerResponse } from './protocol';

let dataset: Dataset | null = null;
let lastPackage: RulePackage | null = null;
let compiledCache: Map<string, CompiledRule> | null = null;
let abortToken = 0;

const ctx: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  if (msg.type === 'generate') {
    dataset = null;
    compiledCache = null;
    try {
      post({ type: 'progress', requestId: msg.requestId, phase: 'generate', processed: 0, total: msg.n, note: '生成演示数据' });
      const t0 = performance.now();
      dataset = generateDataset({ n: msg.n, seed: msg.seed, days: msg.days });
      post({ type: 'generated', requestId: msg.requestId, summary: dataset.summary, takeMs: Math.round(performance.now() - t0) });
    } catch (e) {
      postError(msg.requestId, e);
    }
    return;
  }

  if (msg.type === 'load') {
    try {
      const floats = {} as DefaultFloatCols;
      for (const k of Object.keys(msg.columns.floats)) {
        (floats as Record<string, Float64Array>)[k] = new Float64Array(msg.columns.floats[k]);
      }
      const ints = {} as DefaultIntCols;
      for (const k of Object.keys(msg.columns.ints)) {
        (ints as Record<string, Uint8Array>)[k] = new Uint8Array(msg.columns.ints[k]);
      }
      const cats = {} as DefaultCatCols;
      for (const k of Object.keys(msg.columns.cats)) {
        (cats as Record<string, { codes: Uint32Array; dict: string[] }>)[k] = {
          codes: new Uint32Array(msg.columns.cats[k].codes),
          dict: msg.columns.cats[k].dict,
        };
      }
      dataset = {
        summary: msg.summary,
        cols: { n: msg.columns.n, floats, ints, cats } as Columns,
        truth: null,
      };
      compiledCache = null;
      post({ type: 'load-done', requestId: msg.requestId, summary: msg.summary });
    } catch (e) {
      postError(msg.requestId, e);
    }
    return;
  }

  if (msg.type === 'replay') {
    try {
      if (!dataset) throw new Error('数据集尚未加载');
      lastPackage = msg.package;
      const token = ++abortToken;
      void runReplayAsync(msg.requestId, msg.package, token);
    } catch (e) {
      postError(msg.requestId, e);
    }
    return;
  }

  if (msg.type === 'rings') {
    try {
      if (!dataset) throw new Error('数据集尚未加载');
      const token = ++abortToken;
      void runRingsAsync(msg.requestId, {
        ...DEFAULT_RING_PARAMS,
        minMembers: msg.minMembers,
        maxIpFanout: msg.maxIpFanout,
        maxShareOfRows: msg.maxShareOfRows,
        includeMerchants: false,
      }, token);
    } catch (e) {
      postError(msg.requestId, e);
    }
    return;
  }
};

type DefaultFloatCols = Columns['floats'];
type DefaultIntCols = Columns['ints'];
type DefaultCatCols = Columns['cats'];

function compilePackage(pkg: RulePackage): Map<string, CompiledRule> {
  if (compiledCache && lastPackage === pkg) return compiledCache;
  const lists = new Map(pkg.lists.map((l) => [l.id, l]));
  const out = new Map<string, CompiledRule>();
  for (const rule of pkg.rules) out.set(rule.id, compileRule(rule, { lists }));
  compiledCache = out;
  return out;
}

async function runReplayAsync(requestId: number, pkg: RulePackage, token: number): Promise<void> {
  const ds = dataset!;
  const columns = ds.cols;
  const truth = ds.truth;
  const compiled = compilePackage(pkg);

  const engine = new RuleEngine(
    { groups: pkg.groups, rules: pkg.rules, lists: pkg.lists, compiled },
    { explain: true },
  );

  const statsById = new Map<string, RuleStats>();
  for (const rule of engine.rules) {
    statsById.set(rule.id, {
      ruleId: rule.id,
      ruleName: rule.name,
      groupName: pkg.groups.find((g) => g.id === rule.group_id)?.name ?? '',
      priority: rule.priority,
      mode: rule.mode,
      action: rule.action,
      severity: rule.severity,
      hits: 0,
      shadowHits: 0,
      enforcedHits: 0,
      fraudHits: 0,
      ringHits: 0,
      legitHits: 0,
      amountAtRisk: 0,
      precision: 0,
      recall: 0,
    });
  }

  const counters = {
    totalHits: 0, enforcedHits: 0, shadowHits: 0,
    fraudRows: 0, legitRows: 0, fraudCaught: 0, fraudCaughtByRing: 0, fraudCaughtBySolo: 0,
    falsePositives: 0, blockedFraudAmount: 0, blockedLegitAmount: 0,
  };
  const finalDecisions: Record<string, number> = { allow: 0 };
  const breakdownMap = new Map<string, DecisionBreakdown>();
  const samples: ReplaySample[] = [];
  const sampleCap = 400;
  const keepSamples = new Set<number>();
  // Sample evenly across the dataset to keep the table representative.
  const sampleStride = Math.max(1, Math.floor(columns.n / sampleCap));

  const row: Row = {} as Row;
  const n = columns.n;
  const t0 = performance.now();
  const CHUNK = 20_000;
  let lastEmit = t0;

  for (let i = 0; i < n; i++) {
    if (token !== abortToken) return;
    fillRow(columns, i, row);
    const res = engine.evaluate(row, columns.floats.ts[i]);
    const isFraud = truth ? truth.fraud[i] > 0 : false;
    const ringId = truth ? truth.ring[i] : 0;
    const amountUsd = columns.floats.amount_usd[i];

    if (truth) {
      if (isFraud) counters.fraudRows++;
      else counters.legitRows++;
    }

    if (res.hits.length > 0) {
      counters.totalHits += res.hits.length;
      for (const hit of res.hits) {
        const stat = statsById.get(hit.ruleId);
        if (!stat) continue;
        stat.hits++;
        if (hit.shadow) stat.shadowHits++;
        else stat.enforcedHits++;
        if (isFraud) {
          stat.fraudHits++;
          if (ringId > 0) stat.ringHits++;
        } else {
          stat.legitHits++;
        }
        stat.amountAtRisk += amountUsd;
        if (hit.shadow) counters.shadowHits++;
      }
      if (res.decision) {
        counters.enforcedHits++;
        const bd = breakdownMap.get(res.decision.ruleId) ?? {
          ruleId: res.decision.ruleId,
          ruleName: res.decision.ruleName,
          fraud: 0,
          legit: 0,
        };
        if (isFraud) {
          bd.fraud++;
          if (res.decision.action !== 'allow') {
            counters.fraudCaught++;
            if (ringId > 0) counters.fraudCaughtByRing++;
            else counters.fraudCaughtBySolo++;
            counters.blockedFraudAmount += amountUsd;
          }
        } else {
          bd.legit++;
          if (res.decision.action !== 'allow') {
            counters.falsePositives++;
            counters.blockedLegitAmount += amountUsd;
          }
        }
        breakdownMap.set(res.decision.ruleId, bd);
      }
      const key = i % sampleStride === 0 ? i : -1;
      if ((samples.length < sampleCap && key >= 0 && !keepSamples.has(key)) || (isFraud && res.decision && samples.length < sampleCap)) {
        keepSamples.add(key);
        samples.push({
          index: i,
          ts: columns.floats.ts[i],
          row: { ...row },
          truth: {
            is_fraud: isFraud,
            kind: truth && truth.fraud[i] === 1 ? 'ring' : truth && truth.fraud[i] === 2 ? 'solo' : 'legit',
            ring: ringId > 0 ? truth?.ringNames[ringId] : undefined,
          },
          hits: res.hits.map((h) => ({
            ruleId: h.ruleId,
            ruleName: h.ruleName,
            groupName: h.groupName,
            mode: h.mode,
            shadow: h.shadow,
            action: h.action,
            severity: h.severity,
            reasons: h.reasons,
          })),
          finalAction: res.finalAction,
          explanation: res.decision?.explanation,
        });
      }
    }

    finalDecisions[res.finalAction] = (finalDecisions[res.finalAction] ?? 0) + 1;

    if ((i + 1) % CHUNK === 0) {
      const now = performance.now();
      post({
        type: 'progress',
        requestId,
        phase: 'replay',
        processed: i + 1,
        total: n,
        rowsPerSecond: Math.round((i + 1) / ((now - t0) / 1000)),
      });
      lastEmit = now;
      // yield so abort messages can land
      await new Promise<void>((r) => setTimeout(r, 0));
    }
  }

  const elapsedMs = performance.now() - t0;
  let fraudTotalKnown = 0;
  if (truth) for (let i = 0; i < n; i++) if (truth.fraud[i] > 0) fraudTotalKnown++;

  const planSignatures = new Set(engine.aggregatePlans.map((p) => p.signature));
  void lastEmit;
  void planSignatures;

  const ruleStats = [...statsById.values()];
  for (const stat of ruleStats) {
    stat.precision = stat.hits > 0 ? stat.fraudHits / stat.hits : 0;
    stat.recall = fraudTotalKnown > 0 ? stat.fraudHits / fraudTotalKnown : 0;
  }
  ruleStats.sort((a, b) => b.hits - a.hits);

  const summary: ReplaySummary = {
    processed: n,
    elapsedMs,
    rowsPerSecond: Math.round((n / Math.max(1, elapsedMs)) * 1000),
    totalHits: counters.totalHits,
    enforcedHits: counters.enforcedHits,
    shadowHits: counters.shadowHits,
    finalDecisions,
    ruleStats,
    fraudRows: counters.fraudRows,
    fraudCaught: counters.fraudCaught,
    fraudCaughtByRing: counters.fraudCaughtByRing,
    fraudCaughtBySolo: counters.fraudCaughtBySolo,
    legitRows: counters.legitRows,
    falsePositives: counters.falsePositives,
    precision: counters.enforcedHits > 0 ? counters.fraudCaught / counters.enforcedHits : 0,
    recall: counters.fraudRows > 0 ? counters.fraudCaught / counters.fraudRows : 0,
    blockedFraudAmountUsd: Math.round(counters.blockedFraudAmount),
    blockedLegitAmountUsd: Math.round(counters.blockedLegitAmount),
    samples: samples.sort((a, b) => a.ts - b.ts),
    breakdown: [...breakdownMap.values()].sort((a, b) => b.fraud + b.legit - (a.fraud + a.legit)),
    hasLabels: !!truth,
  };

  post({ type: 'replay-done', requestId, summary });
}

async function runRingsAsync(requestId: number, params: RingParameters, token: number): Promise<void> {
  const ds = dataset!;
  post({ type: 'progress', requestId, phase: 'rings', processed: 0, total: ds.cols.n, note: '构建关联图' });
  await new Promise<void>((r) => setTimeout(r, 0));
  if (token !== abortToken) return;
  const analysis = detectRings(ds.cols, ds.truth, params);
  post({ type: 'rings-done', requestId, analysis });
}

function post(msg: WorkerResponse) {
  ctx.postMessage(msg);
}

function postError(requestId: number, e: unknown) {
  const err = e as Error;
  post({ type: 'error', requestId, message: err?.message ?? String(e), stack: err?.stack });
}
