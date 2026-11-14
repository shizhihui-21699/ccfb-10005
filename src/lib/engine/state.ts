/**
 * Sliding-window aggregate state.
 *
 * Per group key we keep an append-only, timestamp-sorted event log plus an O(1)
 * running total. Expiring an event subtracts from the totals; expired slots are
 * compacted away periodically so memory stays proportional to the live window.
 */

export type AggKind = 'count' | 'sum' | 'avg' | 'min' | 'max' | 'distinct';

interface EventEntry {
  ts: number;
  value: number;
  disc: number;
}

class GroupState {
  events: EventEntry[] = [];
  head = 0;
  sum = 0;
  discCount: Map<number, number> | null = null;

  constructor(public kind: AggKind) {
    if (kind === 'distinct') this.discCount = new Map();
  }

  get live(): number {
    return this.events.length - this.head;
  }

  expire(cutoff: number): void {
    const events = this.events;
    let head = this.head;
    while (head < events.length && events[head].ts <= cutoff) {
      const ev = events[head];
      this.sum -= ev.value;
      if (this.discCount) {
        const c = this.discCount.get(ev.disc);
        if (c !== undefined) {
          if (c <= 1) this.discCount.delete(ev.disc);
          else this.discCount.set(ev.disc, c - 1);
        }
      }
      events[head] = EMPTY;
      head++;
    }
    this.head = head;
    if (head > 32 && head * 2 > events.length) {
      this.events = events.slice(head);
      this.head = 0;
    }
  }

  add(ts: number, value: number, disc: number): void {
    this.events.push({ ts, value, disc });
    this.sum += value;
    if (this.discCount) this.discCount.set(disc, (this.discCount.get(disc) ?? 0) + 1);
  }

  compute(): number {
    const live = this.live;
    switch (this.kind) {
      case 'count':
        return live;
      case 'sum':
        return this.sum;
      case 'avg':
        return live === 0 ? 0 : this.sum / live;
      case 'distinct':
        return this.discCount!.size;
      case 'min': {
        let m = Infinity;
        const events = this.events;
        for (let i = this.head; i < events.length; i++) if (events[i].ts !== -1 && events[i].value < m) m = events[i].value;
        return m === Infinity ? 0 : m;
      }
      case 'max': {
        let m = -Infinity;
        const events = this.events;
        for (let i = this.head; i < events.length; i++) if (events[i].ts !== -1 && events[i].value > m) m = events[i].value;
        return m === -Infinity ? 0 : m;
      }
    }
  }
}

const EMPTY: EventEntry = { ts: -1, value: 0, disc: -1 };

export class AggregateWindow {
  readonly kind: AggKind;
  readonly windowMs: number;
  private groups: Map<string, GroupState> = new Map();

  constructor(kind: AggKind, windowMs: number) {
    this.kind = kind;
    this.windowMs = windowMs;
  }

  /** Ingest one event and return the aggregate including it. */
  add(key: string, ts: number, value: number, disc = 0): number {
    let state = this.groups.get(key);
    if (state === undefined) {
      state = new GroupState(this.kind);
      this.groups.set(key, state);
    }
    state.expire(ts - this.windowMs);
    state.add(ts, value, disc);
    return state.compute();
  }

  /** Aggregate value for key as of `now`, without ingesting. */
  peek(key: string, now: number): number {
    const state = this.groups.get(key);
    if (!state) return 0;
    state.expire(now - this.windowMs);
    return state.compute();
  }

  reset(): void {
    this.groups.clear();
  }

  get size(): number {
    return this.groups.size;
  }

  /** Drop groups that no longer have any live events (used between replay passes). */
  prune(now: number): void {
    const cutoff = now - this.windowMs;
    for (const [key, state] of this.groups) {
      state.expire(cutoff);
      if (state.live === 0) this.groups.delete(key);
    }
  }
}

export class WindowStore {
  private windows = new Map<string, AggregateWindow>();

  get(kind: AggKind, windowMs: number): AggregateWindow {
    const id = kind + ':' + windowMs;
    let w = this.windows.get(id);
    if (!w) {
      w = new AggregateWindow(kind, windowMs);
      this.windows.set(id, w);
    }
    return w;
  }

  reset(): void {
    for (const w of this.windows.values()) w.reset();
  }
}
