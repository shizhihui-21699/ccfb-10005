<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';

  interface Props {
    open: boolean;
    title: string;
    subtitle?: string;
    width?: number;
    onclose: () => void;
    children: Snippet;
    footer?: Snippet;
  }
  const { open, title, subtitle, width = 560, onclose, children, footer }: Props = $props();

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') onclose();
  }
</script>

<svelte:window onkeydown={onKey} />

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="backdrop" onclick={onclose}>
    <div class="modal" style="width:min({width}px, calc(100vw - 40px))" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title} tabindex="-1">
      <div class="modal-head">
        <div>
          <div class="modal-title">{title}</div>
          {#if subtitle}<div class="modal-sub">{subtitle}</div>{/if}
        </div>
        <button class="btn ghost icon" onclick={onclose} aria-label="关闭"><Icon name="x" /></button>
      </div>
      <div class="modal-body">{@render children()}</div>
      {#if footer}
        <div class="modal-foot">{@render footer()}</div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(4, 7, 14, 0.7);
    backdrop-filter: blur(3px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 900;
    animation: fade 0.15s ease;
  }
  .modal {
    background: var(--bg-elev);
    border: 1px solid var(--border-strong);
    border-radius: 16px;
    box-shadow: 0 24px 70px rgba(0, 0, 0, 0.6);
    max-height: calc(100vh - 80px);
    display: flex;
    flex-direction: column;
    animation: pop 0.18s cubic-bezier(0.2, 0.9, 0.3, 1.2);
  }
  .modal-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    padding: 16px 18px 12px;
  }
  .modal-title { font-size: 15px; font-weight: 600; }
  .modal-sub { font-size: 12px; color: var(--text-dim); margin-top: 3px; }
  .modal-body { padding: 4px 18px 16px; overflow-y: auto; }
  .modal-foot {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 12px 18px;
    border-top: 1px solid var(--border);
  }
  @keyframes fade { from { opacity: 0; } }
  @keyframes pop { from { opacity: 0; transform: scale(0.97) translateY(6px); } }
</style>
