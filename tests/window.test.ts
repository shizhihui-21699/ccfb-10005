import { describe, expect, it } from 'vitest';
import { AggregateWindow } from '../src/lib/engine/state';

const M = 60_000;
const T = Date.UTC(2026, 2, 1, 12, 0, 0);

// Convention: an event exactly `windowMs` old is expired (ts <= now - window).

describe('sliding windows', () => {
  it('counts events inside the window and expires at the boundary', () => {
    const w = new AggregateWindow('count', 10 * M);
    expect(w.add('c1', T, 1)).toBe(1);
    expect(w.add('c1', T + 5 * M, 1)).toBe(2);
    expect(w.add('c1', T + 9 * M + 59_000, 1)).toBe(3);
    // At exactly +10m the event at T is expired, so the new one replaces it.
    expect(w.add('c1', T + 10 * M, 1)).toBe(3);
    // Latest event is at +9m59s; it expires once now >= +19m59s.
    expect(w.peek('c1', T + 19 * M + 58_000)).toBe(2);
    expect(w.peek('c1', T + 19 * M + 59_000)).toBe(1);
    expect(w.peek('c1', T + 30 * M)).toBe(0);
  });

  it('keeps independent state per grouping key', () => {
    const w = new AggregateWindow('count', 10 * M);
    w.add('a', T, 1);
    w.add('a', T + 1000, 1);
    w.add('b', T, 1);
    expect(w.peek('a', T + 2000)).toBe(2);
    expect(w.peek('b', T + 2000)).toBe(1);
    expect(w.peek('missing', T + 2000)).toBe(0);
  });

  it('sums amounts and removes expired amounts correctly', () => {
    const w = new AggregateWindow('sum', 10 * M);
    w.add('c', T, 100);
    w.add('c', T + 2 * M, 250);
    expect(w.add('c', T + 3 * M, 50)).toBe(400);
    expect(w.peek('c', T + 11 * M)).toBe(300); // t=0 (100) expired
    expect(w.peek('c', T + 12 * M)).toBe(50); // t=+2m also expired at cutoff
    expect(w.peek('c', T + 13 * M)).toBe(0);
  });

  it('tracks distinct counts by hashed value', () => {
    const w = new AggregateWindow('distinct', 60 * M);
    expect(w.add('ip', T, 0, 1)).toBe(1);
    expect(w.add('ip', T + 1000, 0, 1)).toBe(1);
    expect(w.add('ip', T + 2000, 0, 2)).toBe(2);
    expect(w.add('ip', T + 3000, 0, 3)).toBe(3);
    // At now=+60m the cutoff is T, so the t=T event expires and 3 remain.
    expect(w.peek('ip', T + 60 * M)).toBe(3);
    // At now=+60m+3s the cutoff is T+3s, so all four have expired.
    expect(w.peek('ip', T + 60 * M + 3000)).toBe(0);
  });

  it('handles min/max with expiring extremes', () => {
    const w = new AggregateWindow('min', 10 * M);
    w.add('c', T, 5);
    w.add('c', T + M, 9);
    w.add('c', T + 2 * M, 7);
    expect(w.peek('c', T + 3 * M)).toBe(5);
    expect(w.peek('c', T + 11 * M)).toBe(7); // 5 and 9 both expired at cutoff T+1m
    const mx = new AggregateWindow('max', 10 * M);
    mx.add('c', T, 5);
    mx.add('c', T + M, 50);
    expect(mx.peek('c', T + 2 * M)).toBe(50);
    expect(mx.peek('c', T + 11 * M)).toBe(0);
  });

  it('compacts storage as events expire', () => {
    const w = new AggregateWindow('count', M);
    for (let i = 0; i < 500; i++) w.add('c', T + i * 200, 1); // spans 100s
    // At +100s only the last 60s (300 events) remain.
    expect(w.peek('c', T + 99_800)).toBe(300);
    expect(w.add('c', T + 100_000, 1)).toBe(300);
  });

  it('averages across only live events', () => {
    const w = new AggregateWindow('avg', 10 * M);
    w.add('c', T, 10);
    w.add('c', T + M, 30);
    expect(w.peek('c', T + 2 * M)).toBe(20);
    expect(w.peek('c', T + 10 * M + 1)).toBe(30); // 10 expired at cutoff T+1m
    expect(w.peek('c', T + 11 * M + 1)).toBe(0);
  });
});
