import type { CompiledRule } from '../dsl/compiler';
import type { Columns, Row, TruthColumns } from '../data/schema';
import { fillRow } from '../data/schema';
import type { RulePackage, RuleVersion } from '../types';
import { RuleEngine, type EvalResult } from './engine';

export interface ReplayConfig {
  package: RulePackage;
  compiled: Map<string, CompiledRule>;
  columns: Columns;
  truth: TruthColumns | null;
  /** Cap the number of rows to process (undefined = all). */
  limit?: number;
  startTs?: number;
  endTs?: number;
  /** Rows to skip before evaluating (used for chunked workers). */
  offset?: number;
  explainSample?: number;
}

export interface RuleStats {
  ruleId: string;
  ruleName: string;
  groupName: string;
  priority: number;
  mode: string;
  action: string;
  severity: string;
  hits: number;
  shadowHits: number;
  enforcedHits: number;
  fraudHits: number;
  ringHits: number;
  legitHits: number;
  amountAtRisk: number;
  /** of all hits, those that are fraud (precision) */
  precision: number;
  /** of all fraud rows in the dataset, the share this rule caught (recall) */
  recall: number;
}

export interface ReplaySample {
  index: number;
  ts: number;
  row: Row;
  truth: { is_fraud: boolean; kind?: string; ring?: string };
  hits: Array<{
    ruleId: string;
    ruleName: string;
    groupName: string;
    mode: string;
    shadow: boolean;
    action: string;
    severity: string;
    reasons: string[];
  }>;
  finalAction: string;
  explanation?: unknown;
}

export interface ReplayProgress {
  processed: number;
  total: number;
  elapsedMs: number;
}

export interface ReplaySummary {
  processed: number;
  elapsedMs: number;
  rowsPerSecond: number;
  totalHits: number;
  enforcedHits: number;
  shadowHits: number;
  finalDecisions: Record<string, number>;
  ruleStats: RuleStats[];
  fraudRows: number;
  fraudCaught: number;
  fraudCaughtByRing: number;
  fraudCaughtBySolo: number;
  legitRows: number;
  falsePositives: number;
  precision: number;
  recall: number;
  /** Amount in USD that enforcement would have blocked correctly. */
  blockedFraudAmountUsd: number;
  /** Amount in USD wrongly blocked. */
  blockedLegitAmountUsd: number;
  samples: ReplaySample[];
  breakdown: DecisionBreakdown[];
  /** False when the dataset has no ground-truth labels (uploaded data). */
  hasLabels: boolean;
}

export interface DecisionBreakdown {
  ruleId: string;
  ruleName: string;
  fraud: number;
  legit: number;
}

export interface ReplayRunner {
  run(): ReplaySummary;
}

/**
 * Synchronous replay over the full row range. Callers that need incremental
 * progress should use `runReplayChunked` from the worker.
 */
export function runReplay(config: ReplayConfig): ReplaySummary {
  const { columns, truth } = config;
  const offset = config.offset ?? 0;
  const end = config.limit == null ? columns.n : Math.min(columns.n, offset + config.limit);
  const total = end - offset;

  const engine = new RuleEngine(
    { groups: config.package.groups, rules: config.package.rules, lists: config.package.lists, compiled: config.compiled },
    { explain: (config.explainSample ?? 0) > 0 },
  );
  engine.reset();

  const statsById = new Map<string, RuleStats>();
  for (const rule of engine.rules) {
    statsById.set(rule.id, {
      ruleId: rule.id,
      ruleName: rule.name,
      groupName: config.package.groups.find((g) => g.id === rule.group_id)?.name ?? '',
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

  let fraudRows = 0;
  let legitRows = 0;
  let fraudCaught = 0;
  let fraudCaughtByRing = 0;
  let fraudCaughtBySolo = 0;
  let falsePositives = 0;
  let totalHits = 0;
  let enforcedHits = 0;
  let shadowHits = 0;
  let blockedFraudAmount = 0;
  let blockedLegitAmount = 0;
  const finalDecisions: Record<string, number> = { allow: 0 };
  const samples: ReplaySample[] = [];
  const explainSample = config.explainSample ?? 0;
  const breakdownMap = new Map<string, DecisionBreakdown>();
  const liveStats = [...statsById.values()];

  const row = fillRow(columns, offset, {} as Row);
  // Precompute truth totals for recall.
  let fraudTotalKnown = 0;
  if (truth) for (let i = 0; i < columns.n; i++) if (truth.fraud[i] > 0) fraudTotalKnown++;

  const started = performance.now();
  for (let i = offset; i < end; i++) {
    fillRow(columns, i, row);
    const res: EvalResult = engine.evaluate(row, columns.floats.ts[i]);
    const isFraud = truth ? truth.fraud[i] > 0 : false;
    const ringId = truth ? truth.ring[i] : 0;
    const amountUsd = columns.floats.amount_usd[i];

    if (truth) {
      if (isFraud) fraudRows++;
      else legitRows++;
    }

    if (res.hits.length > 0) {
      totalHits += res.hits.length;
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
      }
      for (const hit of res.hits) if (hit.shadow) shadowHits++;
      if (res.decision) {
        enforcedHits++;
        const bd = breakdownMap.get(res.decision.ruleId) ?? {
          ruleId: res.decision.ruleId,
          ruleName: res.decision.ruleName,
          fraud: 0,
          legit: 0,
        };
        if (isFraud) {
          bd.fraud++;
          if (res.decision.action !== 'allow') {
            fraudCaught++;
            if (ringId > 0) fraudCaughtByRing++;
            else fraudCaughtBySolo++;
            blockedFraudAmount += amountUsd;
          }
        } else {
          bd.legit++;
          if (res.decision.action !== 'allow') {
            falsePositives++;
            blockedLegitAmount += amountUsd;
          }
        }
        breakdownMap.set(res.decision.ruleId, bd);
      }
    }

    finalDecisions[res.finalAction] = (finalDecisions[res.finalAction] ?? 0) + 1;

    if (samples.length < explainSample && res.hits.length > 0 && res.decision) {
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

  const elapsedMs = performance.now() - started;
  for (const stat of liveStats) {
    stat.precision = stat.hits > 0 ? stat.fraudHits / stat.hits : 0;
    stat.recall = fraudTotalKnown > 0 ? stat.fraudHits / fraudTotalKnown : 0;
  }

  return {
    processed: total,
    elapsedMs,
    rowsPerSecond: elapsedMs > 0 ? Math.round((total / elapsedMs) * 1000) : total,
    totalHits,
    enforcedHits,
    shadowHits,
    finalDecisions,
    ruleStats: liveStats.sort((a, b) => b.hits - a.hits),
    fraudRows,
    fraudCaught,
    fraudCaughtByRing,
    fraudCaughtBySolo,
    legitRows,
    falsePositives,
    precision: enforcedHits > 0 ? fraudCaught / enforcedHits : 0,
    recall: fraudRows > 0 ? fraudCaught / fraudRows : 0,
    blockedFraudAmountUsd: Math.round(blockedFraudAmount),
    blockedLegitAmountUsd: Math.round(blockedLegitAmount),
    samples,
    breakdown: [...breakdownMap.values()].sort((a, b) => b.fraud + b.legit - (a.fraud + a.legit)),
    hasLabels: !!truth,
  };
}

export interface ChunkState {
  index: number;
  engine: RuleEngine;
  row: Row;
  statsById: Map<string, RuleStats>;
  counters: Record<string, number>;
  samples: ReplaySample[];
  breakdownMap: Map<string, DecisionBreakdown>;
  fraudTotalKnown: number;
  startedAt: number;
}

export function createChunkState(config: ReplayConfig): ChunkState {
  const engine = new RuleEngine(
    { groups: config.package.groups, rules: config.package.rules, lists: config.package.lists, compiled: config.compiled },
    { explain: (config.explainSample ?? 0) > 0 },
  );
  const statsById = new Map<string, RuleStats>();
  for (const rule of engine.rules) {
    statsById.set(rule.id, {
      ruleId: rule.id,
      ruleName: rule.name,
      groupName: config.package.groups.find((g) => g.id === rule.group_id)?.name ?? '',
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
  let fraudTotal = 0;
  if (config.truth) for (let i = 0; i < config.columns.n; i++) if (config.truth.fraud[i] > 0) fraudTotal++;
  return {
    index: config.offset ?? 0,
    engine,
    row: {} as Row,
    statsById,
    counters: {
      processed: 0, totalHits: 0, enforcedHits: 0, shadowHits: 0, fraudRows: 0, legitRows: 0,
      fraudCaught: 0, fraudCaughtByRing: 0, fraudCaughtBySolo: 0, falsePositives: 0,
      blockedFraudAmount: 0, blockedLegitAmount: 0, allow: 0,
    },
    samples: [],
    breakdownMap: new Map(),
    fraudTotalKnown: fraudTotal,
    startedAt: performance.now(),
  };
}
