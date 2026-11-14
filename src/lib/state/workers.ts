import type { CompiledRule, Diagnostic } from '../dsl/compiler';
import type { DatasetSummary, Columns } from '../data/schema';
import type { RulePackage } from '../types';
import { dataset } from './dataset.svelte';
import type { RingAnalysis } from '../engine/rings';
import type { ReplaySummary } from '../engine/replay';
import type { WorkerRequest, WorkerResponse } from '../workers/protocol';

interface Pending {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  onProgress?: (msg: WorkerResponse & { type: 'progress' }) => void;
}

export class AnalysisClient {
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private lastSummary: DatasetSummary | null = null;

  constructor() {
    this.worker = new Worker(new URL('../workers/analysis.worker.ts', import.meta.url), {
      type: 'module',
    });
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const msg = event.data;
      if (msg.type === 'progress') {
        this.pending.get(msg.requestId)?.onProgress?.(msg);
        return;
      }
      const pending = this.pending.get(msg.requestId);
      if (!pending) return;
      this.pending.delete(msg.requestId);
      if (msg.type === 'error') pending.reject(new Error(msg.message));
      else if (msg.type === 'generated') {
        this.lastSummary = msg.summary;
        dataset.summary = msg.summary;
        pending.resolve(msg);
      } else if (msg.type === 'load-done') pending.resolve(msg);
      else if (msg.type === 'replay-done') pending.resolve(msg.summary);
      else if (msg.type === 'rings-done') pending.resolve(msg.analysis);
    };
    this.worker.onerror = (e) => {
      for (const p of this.pending.values()) p.reject(new Error(e.message || '分析线程崩溃'));
      this.pending.clear();
    };
  }

  private send<T>(req: WorkerRequest, onProgress?: Pending['onProgress']): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.pending.set(req.requestId, {
        resolve: resolve as (v: unknown) => void,
        reject,
        onProgress,
      });
      this.worker.postMessage(req);
    });
  }

  load(summary: DatasetSummary, cols: Columns): Promise<{ summary: DatasetSummary }> {
    // Copy typed arrays into transferable buffers so the worker owns them.
    const floats: Record<string, ArrayBuffer> = {};
    for (const [k, v] of Object.entries(cols.floats)) {
      floats[k] = v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) as ArrayBuffer;
    }
    const ints: Record<string, ArrayBuffer> = {};
    for (const [k, v] of Object.entries(cols.ints)) {
      ints[k] = v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) as ArrayBuffer;
    }
    const cats: Record<string, { codes: ArrayBuffer; dict: string[] }> = {};
    for (const [k, v] of Object.entries(cols.cats)) {
      cats[k] = { codes: v.codes.buffer.slice(v.codes.byteOffset, v.codes.byteOffset + v.codes.byteLength) as ArrayBuffer, dict: v.dict };
    }
    return this.send<{ summary: DatasetSummary }>(
      { type: 'load', requestId: this.nextId++, summary, columns: { n: cols.n, floats, ints, cats } },
    ).then((res) => {
      dataset.summary = res.summary;
      this.lastSummary = res.summary;
      return res;
    });
  }

  generate(n: number, seed: number, days: number, onProgress?: Pending['onProgress']): Promise<{ summary: DatasetSummary; takeMs: number }> {
    return this.send<{ summary: DatasetSummary; takeMs: number }>(
      { type: 'generate', requestId: this.nextId++, n, seed, days },
      onProgress,
    );
  }

  replay(
    package_: RulePackage,
    rules: Array<{ id: string; name: string; expression: string; group_id: string }>,
    onProgress?: Pending['onProgress'],
  ): Promise<ReplaySummary> {
    return this.send<ReplaySummary>(
      { type: 'replay', requestId: this.nextId++, package: clonePlain(package_), rules },
      onProgress,
    );
  }

  rings(
    params: { minMembers: number; maxIpFanout: number; maxShareOfRows: number },
    onProgress?: Pending['onProgress'],
  ): Promise<RingAnalysis> {
    return this.send<RingAnalysis>(
      { type: 'rings', requestId: this.nextId++, ...params },
      onProgress,
    );
  }

  get summary(): DatasetSummary | null {
    return this.lastSummary;
  }

  terminate() {
    this.worker.terminate();
  }
}

/** structuredClone cannot copy Svelte 5 state proxies; JSON round-trip can. */
function clonePlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

let client: AnalysisClient | null = null;

export function analysisClient(): AnalysisClient {
  if (!client) client = new AnalysisClient();
  return client;
}
