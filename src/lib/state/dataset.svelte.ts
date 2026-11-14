import type { DatasetSummary } from '../data/schema';

/**
 * Dataset metadata lives in the main thread so every page can see what the
 * worker currently holds. The rows themselves never leave the worker.
 */
export const dataset = $state({
  summary: null as DatasetSummary | null,
  generating: false,
  progress: null as { processed: number; total: number; phase: string; rps?: number; note?: string } | null,
  error: null as string | null,
  seed: 20260301,
  days: 30,
  size: 200_000,
});
