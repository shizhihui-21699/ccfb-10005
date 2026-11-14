import type { AggPlan, CompiledRule, EvalContext } from '../dsl/compiler';
import { evalExpr, summarizeExplanation, collectLeaves, type ExplainNode } from './evaluate';
import { WindowStore } from './state';
import { hashString } from '../data/rng';
import type { Action, Rule, RuleGroup, RuleList, RuleMode, Severity } from '../types';

export interface EngineOptions {
  /** Populate explanation trees for every match. Off for high-volume replay. */
  explain?: boolean;
  /** Also evaluate shadow rules (should stay true; only disable to save work). */
  evaluateShadow?: boolean;
}

export interface RuleHit {
  ruleId: string;
  ruleName: string;
  groupId: string;
  groupName: string;
  priority: number;
  action: Action;
  severity: Severity;
  mode: RuleMode;
  /** True when the rule is in shadow mode or the row fell outside its rollout bucket. */
  shadow: boolean;
  reasons: string[];
  leafCount: number;
  passedLeafCount: number;
  explanation?: ExplainNode;
}

export interface EvalResult {
  hits: RuleHit[];
  /** First enforcing hit in evaluation order; decides the outcome. */
  decision: RuleHit | null;
  finalAction: Action | 'allow';
}

export interface EngineInput {
  groups: RuleGroup[];
  rules: Rule[];
  lists: RuleList[];
  compiled: Map<string, CompiledRule>;
  /** Enforce-mode rules with rollout < 100 only enforce for this slice of traffic. */
  settings?: { whitelist_bypass?: boolean };
}

export interface AggressedRow {
  current: Map<number, number>;
}

export class RuleEngine {
  private prepared: Array<{ rule: Rule; compiled: CompiledRule; groupOrder: number; groupName: string }> = [];
  private windowStore = new WindowStore();
  private lists = new Map<string, Set<string>>();
  private explain: boolean;
  private groupNames = new Map<string, string>();
  private mergedPlans: AggPlan[] = [];
  private planKeyMap = new Map<string, number>();
  private planSpecs: Array<{ keyFields: string[]; measureField: string; kind: AggPlan['kind'] }> = [];
  private hitsScratch: RuleHit[] = [];
  private evalCtx: EvalContext;
  private zeroAgg = () => 0;

  constructor(input: EngineInput, options: EngineOptions = {}) {
    this.explain = options.explain ?? false;
    const groupEnabled = new Map(input.groups.map((g) => [g.id, g.enabled]));
    const groupPriority = new Map(input.groups.map((g) => [g.id, g.priority]));
    for (const g of input.groups) this.groupNames.set(g.id, g.name);
    for (const list of input.lists) {
      this.lists.set(list.id, new Set(list.entries.map((e) => e.trim().toLowerCase()).filter(Boolean)));
    }

    for (const rule of input.rules) {
      if (!rule.enabled) continue;
      if (!groupEnabled.get(rule.group_id)) continue;
      const c = input.compiled.get(rule.id);
      if (!c || !c.ok || !c.expr) continue;
      this.prepared.push({
        rule,
        compiled: c,
        groupOrder: groupPriority.get(rule.group_id) ?? 100,
        groupName: this.groupNames.get(rule.group_id) ?? rule.group_id,
      });
    }
    // Higher group priority first, then lower rule priority number first.
    this.prepared.sort((a, b) => b.groupOrder - a.groupOrder || a.rule.priority - b.rule.priority);

    // Merge identical aggregate plans across rules so the same window is fed once.
    const planBySig = new Map<string, number>();
    for (const p of this.prepared) {
      for (const plan of p.compiled.aggregates) {
        let mergedId = planBySig.get(plan.signature);
        if (mergedId === undefined) {
          mergedId = this.mergedPlans.length;
          planBySig.set(plan.signature, mergedId);
          this.mergedPlans.push({ ...plan, id: mergedId });
          const measure = plan.measure && plan.measure.kind === 'field' ? plan.measure.name : 'amount_usd';
          this.planSpecs.push({ keyFields: plan.keyFields, measureField: measure, kind: plan.kind });
        }
        this.planKeyMap.set(`${p.rule.id}:${plan.id}`, mergedId);
      }
    }

    this.evalCtx = { row: {}, agg: () => 0, list: () => false, timestamp: 0 };
  }

  get rules(): Rule[] {
    return this.prepared.map((p) => p.rule);
  }

  get aggregatePlans(): AggPlan[] {
    return this.mergedPlans;
  }

  get totalRuleCount(): number {
    return this.prepared.length;
  }

  reset(): void {
    this.windowStore.reset();
  }

  /**
   * Feed all aggregate windows for this row, then evaluate every rule.
   * The row must be processed once, in timestamp order.
   */
  evaluate(row: Record<string, unknown>, ts?: number): EvalResult {
    const now = ts ?? (Number(row.ts) || 0);
    const current = new Map<number, number>();

    for (let i = 0; i < this.mergedPlans.length; i++) {
      const plan = this.mergedPlans[i];
      const spec = this.planSpecs[i];
      const win = this.windowStore.get(spec.kind, plan.windowMs);
      const key = keyFor(spec.keyFields, row);
      let matches = true;
      if (plan.filterExpr) {
        this.evalCtx.row = row;
        this.evalCtx.agg = this.zeroAgg;
        this.evalCtx.list = this.listLookup;
        this.evalCtx.timestamp = now;
        matches = !!evalExpr(plan.filterExpr, this.evalCtx, false).value;
      }
      if (!matches) {
        current.set(i, win.peek(key, now));
        continue;
      }
      let value: number;
      if (spec.kind === 'count') value = 1;
      else if (spec.kind === 'distinct') value = 0;
      else value = Number(row[spec.measureField]) || 0;
      const disc = spec.kind === 'distinct' ? hashString(String(row[spec.measureField] ?? '')) : 0;
      current.set(i, win.add(key, now, value, disc));
    }

    // map rule-local ids to merged ids once per rule evaluation
    const hits: RuleHit[] = [];
    let bypassHit: RuleHit | null = null;
    const ctx = this.evalCtx;
    ctx.row = row;
    ctx.timestamp = now;

    for (const p of this.prepared) {
      // A whitelist hit short-circuits the rest of the rule set.
      if (bypassHit) break;
      const compiled = p.compiled;
      if (!compiled.expr) continue;
      const aggIdRemap = compiled.aggregates.length > 0 ? this.remapFor(p.rule.id, compiled) : null;
      ctx.agg = aggIdRemap ? (id: number) => current.get(aggIdRemap[id]) ?? 0 : this.zeroAgg;
      ctx.list = this.listLookup;

      const res = evalExpr(compiled.expr, ctx, this.explain);
      if (!res.value) continue;

      const shadow = p.rule.mode === 'shadow' || (p.rule.mode === 'enforce' && !inRollout(p.rule, row));
      const hit: RuleHit = {
        ruleId: p.rule.id,
        ruleName: p.rule.name,
        groupId: p.rule.group_id,
        groupName: p.groupName,
        priority: p.rule.priority,
        action: p.rule.action,
        severity: p.rule.severity,
        mode: p.rule.mode,
        shadow,
        reasons: this.explain ? summarizeExplanation(res.node) : [],
        leafCount: this.explain && res.node ? collectLeaves(res.node).length : 0,
        passedLeafCount: this.explain && res.node ? collectLeaves(res.node).filter((l) => l.pass).length : 0,
        explanation: res.node,
      };
      hits.push(hit);
      if (!shadow && p.rule.action === 'allow' && !bypassHit) bypassHit = hit;
    }

    let decision: RuleHit | null = null;
    for (const hit of hits) {
      if (!hit.shadow) {
        decision = hit;
        break;
      }
    }
    if (bypassHit) {
      return { hits, decision: bypassHit, finalAction: 'allow' };
    }
    return { hits, decision, finalAction: decision ? decision.action : 'allow' };
  }

  private remapCache = new Map<string, number[]>();
  private remapFor(ruleId: string, compiled: CompiledRule): number[] {
    const cached = this.remapCache.get(ruleId);
    if (cached) return cached;
    const out = compiled.aggregates.map((a) => this.planKeyMap.get(`${ruleId}:${a.id}`) ?? -1);
    this.remapCache.set(ruleId, out);
    return out;
  }

  private listLookup = (listId: string, value: unknown): boolean => {
    const set = this.lists.get(listId);
    if (!set) return false;
    return set.has(String(value ?? '').trim().toLowerCase());
  };

  setLists(lists: RuleList[]): void {
    this.lists.clear();
    for (const list of lists) {
      this.lists.set(list.id, new Set(list.entries.map((e) => e.trim().toLowerCase()).filter(Boolean)));
    }
  }
}

export function keyFor(fields: string[], row: Record<string, unknown>): string {
  if (fields.length === 1) {
    const v = row[fields[0]];
    return v === null || v === undefined ? '' : String(v);
  }
  let s = '';
  for (let i = 0; i < fields.length; i++) {
    if (i > 0) s += '\u0001';
    const v = row[fields[i]];
    s += v === null || v === undefined ? '' : String(v);
  }
  return s;
}

export function inRollout(rule: Rule, row: Record<string, unknown>): boolean {
  if (rule.rollout >= 100) return true;
  if (rule.rollout <= 0) return false;
  // Bucket by card so the same card always lands in the same experiment arm.
  const salt = rule.id + ':' + String(row.card_hash ?? '');
  return hashString(salt) % 100 < rule.rollout;
}
