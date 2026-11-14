<script lang="ts">
  import type { Diagnostic } from '../dsl/compiler';
  import Icon from './Icon.svelte';

  interface Props {
    diagnostics: Diagnostic[];
    compact?: boolean;
  }
  const { diagnostics, compact = false }: Props = $props();

  const sevIcon = (s: string) => (s === 'error' ? 'x' : s === 'warning' ? 'alert' : 'info');
</script>

{#if diagnostics.length > 0}
  <div class="diags {compact ? 'compact' : ''}">
    {#each diagnostics.slice(0, compact ? 3 : 20) as d, i}
      <div class="diag {d.severity}">
        <span class="di">{#if d.line}<span class="loc mono">{d.line}:{d.column ?? 0}</span>{/if}<Icon name={sevIcon(d.severity)} size={13} /></span>
        <div class="body">
          <span class="msg">{d.message}</span>
          {#if d.hint}<span class="hint">{d.hint}</span>{/if}
        </div>
      </div>
    {/each}
    {#if compact && diagnostics.length > 3}
      <div class="more">还有 {diagnostics.length - 3} 条…</div>
    {/if}
  </div>
{:else}
  <div class="ok"><Icon name="check" size={13} /> 语法检查通过</div>
{/if}

<style>
  .diags { display: flex; flex-direction: column; gap: 5px; }
  .diag {
    display: flex;
    gap: 8px;
    padding: 7px 10px;
    border-radius: 7px;
    font-size: 12px;
    line-height: 1.45;
    background: rgba(148, 163, 184, 0.06);
    border-left: 2px solid var(--text-faint);
  }
  .diag.error { background: var(--red-soft); border-left-color: var(--red); }
  .diag.warning { background: var(--amber-soft); border-left-color: var(--amber); }
  .diag.info { background: var(--accent-soft); border-left-color: var(--accent); }
  .di { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
  .diag.error .di { color: var(--red); }
  .diag.warning .di { color: var(--amber); }
  .diag.info .di { color: var(--accent); }
  .loc {
    font-size: 10.5px;
    opacity: 0.8;
    background: rgba(0, 0, 0, 0.25);
    padding: 1px 5px;
    border-radius: 4px;
  }
  .body { display: flex; flex-direction: column; gap: 2px; }
  .msg { color: var(--text); }
  .hint { color: var(--text-dim); font-size: 11.5px; }
  .compact .hint { display: none; }
  .more { font-size: 11px; color: var(--text-faint); padding-left: 10px; }
  .ok {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--green);
  }
</style>
