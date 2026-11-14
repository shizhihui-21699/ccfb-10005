import type { AggPlan } from '../dsl/compiler';
import type { ReplaySummary, ReplaySample } from '../engine/replay';
import type { RingAnalysis } from '../engine/rings';
import type { DatasetSummary } from '../data/schema';
import type { RulePackage } from '../types';

export interface WorkerRequestGenerate {
  type: 'generate';
  requestId: number;
  n: number;
  seed: number;
  days: number;
}

export interface ImportedColumnsPayload {
  n: number;
  floats: Record<string, ArrayBuffer>;
  ints: Record<string, ArrayBuffer>;
  cats: Record<string, { codes: ArrayBuffer; dict: string[] }>;
}

export interface WorkerRequestLoad {
  type: 'load';
  requestId: number;
  summary: DatasetSummary;
  columns: ImportedColumnsPayload;
}

export interface WorkerRequestReplay {
  type: 'replay';
  requestId: number;
  package: RulePackage;
  rules: Array<{ id: string; name: string; expression: string; group_id: string }>;
}

export interface WorkerRequestRings {
  type: 'rings';
  requestId: number;
  minMembers: number;
  maxIpFanout: number;
  maxShareOfRows: number;
}

export type WorkerRequest = WorkerRequestGenerate | WorkerRequestLoad | WorkerRequestReplay | WorkerRequestRings;

export interface WorkerResponseProgress {
  type: 'progress';
  requestId: number;
  phase: 'generate' | 'replay' | 'explain' | 'rings';
  processed: number;
  total: number;
  rowsPerSecond?: number;
  note?: string;
}

export interface WorkerResponseGenerated {
  type: 'generated';
  requestId: number;
  summary: DatasetSummary;
  takeMs: number;
}

export interface WorkerResponseLoaded {
  type: 'load-done';
  requestId: number;
  summary: DatasetSummary;
}

export interface WorkerResponseReplay {
  type: 'replay-done';
  requestId: number;
  summary: ReplaySummary;
}

export interface WorkerResponseRings {
  type: 'rings-done';
  requestId: number;
  analysis: RingAnalysis;
}

export interface WorkerResponseError {
  type: 'error';
  requestId: number;
  message: string;
  stack?: string;
}

export type WorkerResponse =
  | WorkerResponseLoaded
  | WorkerResponseProgress
  | WorkerResponseGenerated
  | WorkerResponseReplay
  | WorkerResponseRings
  | WorkerResponseError;
