<script lang="ts">
  import type { ExplainNode } from '../dsl/compiler';
  import Self from './Explanation.svelte';

  interface Props {
    node: ExplainNode;
    depth?: number;
  }
  const { node, depth = 0 }: Props = $props();

  function fmt(v: unknown): string {
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (typeof v === 'number') return Number.isInteger(v) ? v.toLocaleString('en-US') : v.toFixed(2);
    if (v === null || v === undefined) return '空';
    return String(v);
  }

  const verdict = $derived(nodeLabel());
  function nodeLabel(): string {
    if (node.kind === 'and') return node.pass ? '全部满足' : '存在不满足的条件';
    if (node.kind === 'or') return node.pass ? '存在满足的条件' : '全部不满足';
    if (node.kind === 'not') return '否定';
    return node.pass ? '成立' : '不成立';
  }
</script>

<div class="node {node.pass ? 'pass' : 'fail'} {depth > 0 ? 'child' : ''}">
  <div class="head">
    <span class="dot"></span>
    <span class="label">{node.label}</span>
    {#if node.kind === 'compare' || node.kind === 'leaf'}
      <span class="value mono {node.pass ? 'ok' : 'bad'}">{fmt(node.value)}</span>
    {/if}
    {#if node.decisive}<span class="chip red tiny decisive">触发</span>{/if}
  </div>
  {#if node.kind === 'and' || node.kind === 'or' || node.kind === 'not'}
    <div class="children">
      {#each node.children ?? [] as child}
        <Self node={child} depth={depth + 1} />
      {/each}
    </div>
  {:else if node.children && node.children.length}
    <div class="children leaf-children">
      {#each node.children as child}
        <Self node={child} depth={depth + 1} />
      {/each}
    </div>
  {/if}
</div>

<style>
  .node {
    padding: 5px 8px;
    border-radius: 7px;
    font-size: 12px;
    background: rgba(148, 163, 184, 0.04);
    border-left: 2px solid transparent;
  }
  .node.pass { border-left-color: var(--green); }
  .node.fail { border-left-color: rgba(248, 113, 113, 0.5); }
  .node.child { margin-left: 10px; margin-top: 3px; background: transparent; }
  .head { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
  .dot {
    width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0;
    background: var(--green);
  }
  .node.fail .dot { background: var(--red); }
  .label { flex: 1; min-width: 120px; }
  .value { font-size: 11.5px; }
  .value.ok { color: var(--green); }
  .value.bad { color: var(--red); }
  .decisive { animation: pulse 1.4s ease infinite; }
  .children { margin-top: 2px; }
  .leaf-children { opacity: 0.85; }
  @keyframes pulse { 50% { opacity: 0.55; } }
</style>
