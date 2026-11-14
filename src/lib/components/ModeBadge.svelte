<script lang="ts">
  import type { RuleMode } from '../types';
  interface Props { mode: RuleMode; rollout?: number; }
  let { mode, rollout = 100 }: Props = $props();
</script>

{#if mode === 'off'}
  <span class="chip gray tiny">停用</span>
{:else if mode === 'shadow'}
  <span class="chip violet tiny">影子</span>
{:else if rollout >= 100}
  <span class="chip green tiny">拦截</span>
{:else if rollout <= 0}
  <span class="chip violet tiny">影子</span>
{:else}
  <span class="chip amber tiny">灰度 {rollout}%</span>
{/if}
