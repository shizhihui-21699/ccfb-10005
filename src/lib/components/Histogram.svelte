<script lang="ts">
  interface Bucket { label: string; value: number; meta?: string }
  interface Props {
    buckets: Bucket[];
    height?: number;
    color?: string;
    format?: (v: number) => string;
  }
  const { buckets, height = 80, color = '#5b8cff', format = (v) => String(v) }: Props = $props();
  let max = $derived(Math.max(1, ...buckets.map((b) => b.value)));
  let hover = $state<number | null>(null);
</script>

<div class="histo" style="height:{height + 24}px">
  <div class="bars">
    {#each buckets as b, i}
      <div
        class="col-wrap"
        role="button"
        tabindex="0"
        onmouseenter={() => (hover = i)}
        onmouseleave={() => (hover = null)}
        onfocus={() => (hover = i)}
        onblur={() => (hover = null)}
      >
        {#if hover === i}
          <div class="tip">{b.label}: {format(b.value)}{#if b.meta}<br />{b.meta}{/if}</div>
        {/if}
        <div
          class="bar"
          style="height:{Math.max(2, (b.value / max) * height)}px;background:{color};opacity:{hover === i ? 1 : 0.7}"
        ></div>
      </div>
    {/each}
  </div>
  <div class="labels">
    {#each buckets as b, i}
      <span class="lbl" class:dim={hover !== null && hover !== i}>{b.label}</span>
    {/each}
  </div>
</div>

<style>
  .histo { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .bars { display: flex; align-items: flex-end; gap: 3px; flex: 1; min-height: 0; }
  .col-wrap { flex: 1; display: flex; align-items: flex-end; justify-content: center; position: relative; height: 100%; cursor: default; }
  .bar { width: 100%; max-width: 34px; border-radius: 3px 3px 0 0; transition: opacity 0.12s; }
  .labels { display: flex; gap: 3px; }
  .lbl { flex: 1; text-align: center; font-size: 9.5px; color: var(--text-faint); white-space: nowrap; overflow: hidden; }
  .lbl.dim { opacity: 0.45; }
  .tip {
    position: absolute;
    bottom: 100%;
    margin-bottom: 4px;
    background: #1a2438;
    border: 1px solid var(--border-strong);
    padding: 5px 8px;
    border-radius: 6px;
    font-size: 10.5px;
    white-space: nowrap;
    z-index: 5;
    box-shadow: 0 6px 20px rgba(0,0,0,0.4);
    pointer-events: none;
  }
</style>
