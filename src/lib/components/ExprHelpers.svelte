<script lang="ts">
  import { FIELD_MAP, FUNCTIONS, type FnSpec } from '../dsl/functions';
  import Icon from './Icon.svelte';

  interface Props {
    oninsert: (text: string) => void;
  }
  const { oninsert }: Props = $props();

  let tab = $state<'fields' | 'functions' | 'examples'>('functions');
  let query = $state('');

  const filteredFields = $derived(
    [...FIELD_MAP.values()].filter(
      (f) => !query || f.name.includes(query.toLowerCase()) || f.label.includes(query),
    ),
  );
  const filteredFns = $derived(
    FUNCTIONS.filter(
      (f) => !query || f.name.includes(query.toLowerCase()) || f.summary.includes(query),
    ),
  );

  const EXAMPLES = [
    { label: '同卡 10 分钟笔数', expr: 'count(10m, card_hash) >= 5', note: '滑动窗口 · 计数' },
    { label: '同卡 10 分钟金额', expr: 'sum(amount_usd, 10m, card_hash) > 5000', note: '滑动窗口 · 金额' },
    { label: '同 IP 关联多卡', expr: 'distinct(card_hash, 1h, ip) >= 6', note: '关联 · 去重计数' },
    { label: '设备关联多账户', expr: 'distinct(customer_id, 24h, device_id) >= 4', note: '关联 · 团伙' },
    { label: '卡测：小额高频', expr: 'count(10m, card_hash) >= 4 and sum(amount_usd, 10m, card_hash) < 40', note: '组合条件' },
    { label: '名单拦截', expr: 'in_list(card_hash, "blacklist_cards")', note: '名单' },
    { label: '跨地域盗刷', expr: 'card_country == "US" and ip_country in ["NG", "BR"] and amount_usd > 500', note: '地域' },
    { label: '新账户大额', expr: 'customer_tenure_days < 7 and amount_usd > 200', note: '账户' },
    { label: '带过滤的窗口', expr: 'count(1h, ip where amount_usd < 5) >= 10', note: 'where 过滤' },
  ];

  function insertField(name: string) {
    oninsert(name);
  }
  function insertFn(fn: FnSpec) {
    const templates: Record<string, string> = {
      count: 'count(10m, card_hash)',
      sum: 'sum(amount_usd, 10m, card_hash)',
      avg: 'avg(amount_usd, 1h, card_hash)',
      min: 'min(amount_usd, 1h, card_hash)',
      max: 'max(amount_usd, 24h, card_hash)',
      distinct: 'distinct(card_hash, 1h, ip)',
      in_list: 'in_list(card_hash, "blacklist_cards")',
      not_in_list: 'not_in_list(device_id, "whitelist_devices")',
    };
    oninsert(templates[fn.name] ?? `${fn.name}()`);
  }
</script>

<div class="helpers">
  <div class="tabbar">
    <button class={tab === 'functions' ? 'active' : ''} onclick={() => (tab = 'functions')}>函数</button>
    <button class={tab === 'fields' ? 'active' : ''} onclick={() => (tab = 'fields')}>字段</button>
    <button class={tab === 'examples' ? 'active' : ''} onclick={() => (tab = 'examples')}>示例</button>
  </div>

  {#if tab !== 'examples'}
    <div class="search">
      <Icon name="search" size={13} />
      <input bind:value={query} placeholder={tab === 'fields' ? '搜索字段…' : '搜索函数…'} />
    </div>
  {/if}

  <div class="list scroll-y">
    {#if tab === 'functions'}
      {#each filteredFns as fn (fn.name)}
        <button class="item" onclick={() => insertFn(fn)} title="点击插入模板">
          <div class="item-row">
            <span class="fn mono">{fn.name}</span>
            <span class="cat">{fn.category}</span>
          </div>
          <div class="sig mono">{fn.signature}</div>
          <div class="desc">{fn.summary}</div>
        </button>
      {/each}
    {:else if tab === 'fields'}
      {#each filteredFields as f (f.name)}
        <button class="item field-item" onclick={() => insertField(f.name)}>
          <div class="item-row">
            <span class="fname mono">{f.name}</span>
            <span class="type">{f.type}</span>
          </div>
          <div class="desc">{f.label}{#if f.description} · {f.description}{/if}</div>
          {#if f.enum}
            <div class="enum">{f.enum.slice(0, 8).join(' · ')}</div>
          {/if}
        </button>
      {/each}
    {:else}
      {#each EXAMPLES as ex}
        <button class="item example" onclick={() => oninsert(ex.expr)}>
          <div class="item-row">
            <span class="ex-label">{ex.label}</span>
            <span class="cat">{ex.note}</span>
          </div>
          <div class="ex-expr mono">{ex.expr}</div>
        </button>
      {/each}
    {/if}
  </div>
</div>

<style>
  .helpers {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    gap: 8px;
  }
  .search {
    display: flex;
    align-items: center;
    gap: 6px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 7px;
    padding: 0 8px;
    color: var(--text-faint);
  }
  .search input {
    border: none;
    background: transparent;
    padding: 6px 0;
    flex: 1;
    font-size: 12px;
    box-shadow: none;
  }
  .search input:focus { box-shadow: none; }
  .list { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 4px; padding-right: 2px; }
  .item {
    display: flex;
    flex-direction: column;
    gap: 3px;
    text-align: left;
    padding: 7px 9px;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 7px;
    color: var(--text);
  }
  .item:hover { background: var(--bg-hover); border-color: var(--border); }
  .item-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .fn { color: #60a5fa; font-weight: 600; font-size: 12.5px; }
  .fname { color: #7dd3fc; font-size: 12px; }
  .cat { font-size: 10px; color: var(--text-faint); text-transform: uppercase; letter-spacing: 0.05em; }
  .type { font-size: 10px; color: var(--violet); }
  .sig { font-size: 10.5px; color: var(--text-dim); }
  .desc { font-size: 11px; color: var(--text-dim); line-height: 1.4; }
  .enum { font-size: 10px; color: var(--text-faint); font-family: var(--mono); }
  .example .ex-label { font-size: 12px; font-weight: 600; }
  .ex-expr { font-size: 10.5px; color: #93c5fd; word-break: break-all; }
</style>
