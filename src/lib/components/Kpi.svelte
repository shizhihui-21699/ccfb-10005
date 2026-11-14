<script lang="ts">
  import Icon from './Icon.svelte';
  interface Props {
    label: string;
    value: string;
    sub?: string;
    tone?: 'default' | 'green' | 'red' | 'amber' | 'violet';
    icon?: string;
  }
  const { label, value, sub, tone = 'default', icon }: Props = $props();
</script>

<div class="kpi {tone}">
  <div class="kpi-top">
    <span class="kpi-label">{label}</span>
    {#if icon}<span class="kpi-icon"><Icon name={icon} size={13} /></span>{/if}
  </div>
  <div class="kpi-value">{value}</div>
  {#if sub}<div class="kpi-sub">{sub}</div>{/if}
</div>

<style>
  .kpi {
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
  }
  .kpi-top { display: flex; align-items: center; justify-content: space-between; }
  .kpi-icon { color: var(--text-faint); }
  .kpi-sub { font-size: 11px; color: var(--text-dim); }
  .kpi.green .kpi-value { color: var(--green); }
  .kpi.red .kpi-value { color: var(--red); }
  .kpi.amber .kpi-value { color: var(--amber); }
  .kpi.violet .kpi-value { color: var(--violet); }
</style>
