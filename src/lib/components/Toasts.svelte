<script lang="ts">
  import { app } from '../state/store.svelte';
  import Icon from './Icon.svelte';

  const iconFor = (kind: string) => (kind === 'success' ? 'check' : kind === 'error' ? 'x' : kind === 'warn' ? 'alert' : 'info');
</script>

<div class="toasts">
  {#each app.toasts as t (t.id)}
    <div class="toast {t.kind}">
      <Icon name={iconFor(t.kind)} size={15} />
      <span>{t.text}</span>
    </div>
  {/each}
</div>

<style>
  .toasts {
    position: fixed;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    gap: 8px;
    z-index: 1000;
    pointer-events: none;
  }
  .toast {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 10px 16px;
    border-radius: 10px;
    background: #161f33;
    border: 1px solid var(--border-strong);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
    font-size: 12.5px;
    animation: slide-up 0.2s ease;
  }
  .toast.success { border-color: rgba(52,211,153,0.4); color: #a7f3d0; }
  .toast.error { border-color: rgba(248,113,113,0.4); color: #fecaca; }
  .toast.warn { border-color: rgba(251,191,36,0.4); color: #fde68a; }
  @keyframes slide-up {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
  }
</style>
