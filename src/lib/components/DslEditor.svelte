<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { highlight, type HighlightToken } from '../dsl/highlight';
  import type { Diagnostic } from '../dsl/compiler';

  interface Props {
    value: string;
    diagnostics?: Diagnostic[];
    placeholder?: string;
    minHeight?: number;
    onchange: (value: string) => void;
    /** Called on Ctrl/Cmd+Enter to apply/save. */
    onsubmit?: () => void;
    readonly?: boolean;
  }
  let {
    value,
    diagnostics = [],
    placeholder = '例如 count(10m, card_hash) >= 5 and sum(amount_usd, 10m, card_hash) > 5000',
    minHeight = 96,
    onchange,
    onsubmit,
    readonly = false,
  }: Props = $props();

  let textarea = $state<HTMLTextAreaElement | null>(null);
  let scrollTop = $state(0);
  let scrollLeft = $state(0);
  let focused = $state(false);

  let tokens = $derived.by(() => highlight(value));
  let lineCount = $derived(value.split('\n').length);

  function onInput(e: Event) {
    const el = e.target as HTMLTextAreaElement;
    onchange(el.value);
  }

  function onKey(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      onsubmit?.();
      return;
    }
    // auto-close brackets
    if (e.key === '(' || e.key === '[' || e.key === '"') {
      const el = textarea;
      if (!el) return;
      const { selectionStart, selectionEnd } = el;
      const close = e.key === '(' ? ')' : e.key === '[' ? ']' : '"';
      if (e.key === '"' && value[selectionStart - 1] === '"') return;
      e.preventDefault();
      const next = value.slice(0, selectionStart) + e.key + value.slice(selectionEnd);
      onchange(next);
      tick().then(() => {
        el.selectionStart = el.selectionEnd = selectionStart + 1;
      });
    }
  }

  function syncScroll() {
    if (!textarea) return;
    scrollTop = textarea.scrollTop;
    scrollLeft = textarea.scrollLeft;
  }

  onMount(() => {
    syncScroll();
  });

  let errorLine = $derived.by(() => {
    const err = diagnostics.find((d) => d.severity === 'error');
    if (!err) return -1;
    if (err.line) return err.line;
    if (err.offset !== undefined) return value.slice(0, err.offset).split('\n').length;
    return -1;
  });

  function tokenClass(t: HighlightToken): string {
    return t.cls;
  }
</script>

<div class="editor {focused ? 'focused' : ''}" style="min-height:{minHeight}px">
  <div class="gutter" aria-hidden="true">
    {#each Array(lineCount) as _, i}
      <div class="ln {errorLine === i + 1 ? 'err' : ''}">{i + 1}</div>
    {/each}
  </div>
  <div class="input-wrap">
    <div class="backdrop-text mono" style="transform:translate({-scrollLeft}px,{-scrollTop}px)" aria-hidden="true">
      {#each tokens as t}<span class={tokenClass(t)}>{t.text}</span>{/each}
    </div>
    <textarea
      bind:this={textarea}
      class="mono input"
      value={value}
      placeholder={placeholder}
      spellcheck={false}
      autocomplete="off"
      autocapitalize="off"
      readonly={readonly}
      oninput={onInput}
      onkeydown={onKey}
      onscroll={syncScroll}
      onfocus={() => (focused = true)}
      onblur={() => (focused = false)}
      style="min-height:{minHeight}px"
    ></textarea>
  </div>
</div>

<style>
  .editor {
    display: flex;
    background: #060910;
    border: 1px solid var(--border);
    border-radius: 9px;
    overflow: hidden;
    transition: border-color 0.12s, box-shadow 0.12s;
  }
  .editor.focused {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }
  .gutter {
    padding: 10px 6px 10px 10px;
    text-align: right;
    color: #334155;
    font-family: var(--mono);
    font-size: 12px;
    line-height: 20px;
    user-select: none;
    background: rgba(255, 255, 255, 0.015);
    border-right: 1px solid rgba(30, 41, 63, 0.8);
    flex-shrink: 0;
  }
  .ln.err {
    color: var(--red);
    font-weight: 700;
  }
  .input-wrap {
    position: relative;
    flex: 1;
    overflow: hidden;
  }
  .backdrop-text,
  .input {
    font-size: 12.5px;
    line-height: 20px;
    padding: 10px 12px;
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    tab-size: 2;
  }
  .backdrop-text {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    min-height: 100%;
    pointer-events: none;
    color: var(--text);
    will-change: transform;
  }
  .input {
    position: relative;
    display: block;
    width: 100%;
    border: none;
    background: transparent;
    color: transparent;
    caret-color: #93c5fd;
    resize: vertical;
    outline: none;
    overflow: auto;
    box-shadow: none;
  }
  .input:focus {
    border: none;
    box-shadow: none;
  }
  .ws { color: var(--text); }
  .num { color: #fbbf24; }
  .dur { color: #34d399; font-weight: 600; }
  .str { color: #a5d6ff; }
  .kw { color: #c084fc; font-weight: 600; }
  .fn { color: #60a5fa; font-weight: 600; }
  .fld { color: #7dd3fc; }
  .op { color: #94a3b8; }
  .ident { color: #e2e8f0; }
</style>
