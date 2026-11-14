import { describe, expect, it } from 'vitest';
import { compileRule, formatWindow } from '../src/lib/dsl/compiler';
import type { Rule, RuleList } from '../src/lib/types';

function rule(expr: string): Rule {
  return {
    id: 'r1', name: 'test', group_id: 'g1', priority: 10, enabled: true,
    mode: 'shadow', rollout: 0, action: 'review', severity: 'medium',
    expression: expr, reason: '', tags: [], updated_at: 0,
  };
}

const lists = new Map<string, RuleList>([
  ['blacklist_cards', { id: 'blacklist_cards', name: 'black', label: '黑名单卡', kind: 'black', entity_type: 'card', entries: ['abc'], updated_at: 0 }],
]);

describe('DSL compiler', () => {
  it('accepts a simple comparison', () => {
    const c = compileRule(rule('amount_usd > 1000'), { lists });
    expect(c.ok).toBe(true);
    expect(c.aggregates).toHaveLength(0);
  });

  it('parses sliding window aggregates with windows and keys', () => {
    const c = compileRule(rule('count(10m, card_hash) >= 5 and sum(amount_usd, 10m, card_hash) > 5000'), { lists });
    expect(c.ok, JSON.stringify(c.diagnostics)).toBe(true);
    expect(c.aggregates).toHaveLength(2);
    expect(c.aggregates[0].windowMs).toBe(600_000);
    expect(c.aggregates[0].keyFields).toEqual(['card_hash']);
    expect(c.aggregates[0].label).toContain('卡号哈希');
  });

  it('merges duplicate aggregate plans', () => {
    const c = compileRule(rule('count(10m, card_hash) > 2 and count(10m, card_hash) < 100'), { lists });
    expect(c.ok).toBe(true);
    expect(c.aggregates).toHaveLength(1);
  });

  it('detects unknown fields with a suggestion', () => {
    const c = compileRule(rule('amout_usd > 100'), { lists });
    expect(c.ok).toBe(false);
    expect(c.diagnostics[0].message).toContain('未知字段');
    expect(c.diagnostics[0].hint).toContain('amount_usd');
  });

  it('rejects bare durations outside a window', () => {
    const c = compileRule(rule('10m > 5'), { lists });
    expect(c.ok).toBe(false);
  });

  it('validates list references and warns on missing lists', () => {
    const ok = compileRule(rule('in_list(card_hash, "blacklist_cards")'), { lists });
    expect(ok.ok).toBe(true);
    const missing = compileRule(rule('in_list(card_hash, "nope")'), { lists });
    expect(missing.ok).toBe(true);
    expect(missing.diagnostics.some((d) => d.severity === 'warning')).toBe(true);
  });

  it('rejects non-boolean rules', () => {
    const c = compileRule(rule('amount_usd * 2'), { lists });
    expect(c.ok).toBe(false);
    expect(c.diagnostics.some((d) => d.message.includes('布尔'))).toBe(true);
  });

  it('supports where filters and distinct', () => {
    const c = compileRule(rule('distinct(device_id, 1h, ip) > 4 and count(1h, ip where amount_usd < 5) >= 3'), { lists });
    expect(c.ok, JSON.stringify(c.diagnostics)).toBe(true);
    expect(c.aggregates.map((a) => a.kind).sort()).toEqual(['count', 'distinct']);
  });

  it('reports syntax errors with a position', () => {
    const c = compileRule(rule('amount_usd >'), { lists });
    expect(c.ok).toBe(false);
    expect(c.diagnostics[0].offset).toBeGreaterThan(0);
    expect(c.diagnostics[0].line).toBe(1);
  });

  it('formats windows', () => {
    expect(formatWindow(600_000)).toBe('10 分钟');
    expect(formatWindow(3_600_000)).toBe('1 小时');
    expect(formatWindow(86_400_000)).toBe('1 天');
  });
});
