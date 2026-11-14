<script lang="ts">
  import { app, markDirty, toast, compileAll } from '../state/store.svelte';
  import type { RuleList, ListKind, ListEntityType } from '../types';
  import Icon from '../components/Icon.svelte';
  import Modal from '../components/Modal.svelte';

  let selectedId = $state<string | null>(app.package.lists[0]?.id ?? null);
  let query = $state('');
  let filterKind = $state<'all' | ListKind>('all');
  let entryText = $state('');
  let showNew = $state(false);
  let draft = $state({ label: '', id: '', kind: 'black' as ListKind, entity_type: 'card' as ListEntityType, description: '' });

  const selected = $derived(app.package.lists.find((l) => l.id === selectedId) ?? null);
  const compiled = $derived(compileAll(app.package));

  const usageByList = $derived.by(() => {
    const map = new Map<string, Array<{ id: string; name: string }>>();
    for (const [id, c] of compiled) {
      for (const listId of c.listsUsed) {
        let arr = map.get(listId);
        if (!arr) { arr = []; map.set(listId, arr); }
        arr.push({ id, name: c.rule.name });
      }
    }
    return map;
  });

  const filtered = $derived(
    app.package.lists.filter((l) => {
      if (filterKind !== 'all' && l.kind !== filterKind) return false;
      if (query && !l.label.includes(query) && !l.id.includes(query)) return false;
      return true;
    }),
  );

  const entries = $derived(selected ? selected.entries : []);
  const filteredEntries = $derived(
    entries.filter((e) => !query || e.toLowerCase().includes(query.toLowerCase())),
  );

  const kindMeta: Record<ListKind, { label: string; chip: string }> = {
    black: { label: '黑名单', chip: 'red' },
    white: { label: '白名单', chip: 'green' },
    watch: { label: '观察名单', chip: 'amber' },
  };
  const entityLabel: Record<ListEntityType, string> = {
    card: '卡哈希', device: '设备 ID', ip: 'IP', customer: '客户 ID', email: '邮箱哈希', phone: '手机号哈希',
  };

  function parseEntries(text: string): string[] {
    return [...new Set(text.split(/[\n,;\s]+/).map((s) => s.trim()).filter(Boolean))];
  }

  function addEntries() {
    if (!selected) return;
    const parsed = parseEntries(entryText);
    if (parsed.length === 0) return;
    let added = 0;
    for (const e of parsed) {
      if (!selected.entries.includes(e)) {
        selected.entries.push(e);
        added++;
      }
    }
    selected.updated_at = Date.now();
    entryText = '';
    markDirty();
    toast('success', `已添加 ${added} 条${added < parsed.length ? `（${parsed.length - added} 条重复已忽略）` : ''}`);
  }

  function removeEntry(e: string) {
    if (!selected) return;
    selected.entries = selected.entries.filter((x) => x !== e);
    selected.updated_at = Date.now();
    markDirty();
  }

  function createList() {
    const id = draft.id.trim() || draft.label.trim().toLowerCase().replace(/\s+/g, '_');
    if (!id) { toast('error', '请填写名单 ID'); return; }
    if (app.package.lists.some((l) => l.id === id)) { toast('error', '名单 ID 已存在'); return; }
    const list: RuleList = {
      id,
      name: id,
      label: draft.label.trim() || id,
      kind: draft.kind,
      entity_type: draft.entity_type,
      entries: [],
      description: draft.description,
      updated_at: Date.now(),
    };
    app.package.lists.push(list);
    selectedId = id;
    showNew = false;
    draft = { label: '', id: '', kind: 'black', entity_type: 'card', description: '' };
    markDirty();
    toast('success', '名单已创建');
  }

  function deleteList() {
    if (!selected) return;
    const used = usageByList.get(selected.id);
    if (used && used.length > 0) {
      toast('error', `该名单正被 ${used.length} 条规则引用，无法删除`);
      return;
    }
    const idx = app.package.lists.findIndex((l) => l.id === selected.id);
    app.package.lists.splice(idx, 1);
    selectedId = app.package.lists[0]?.id ?? null;
    markDirty();
    toast('warn', '名单已删除');
  }

  function exportList() {
    if (!selected) return;
    const blob = new Blob([JSON.stringify(selected, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selected.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
</script>

<div class="page">
  <div class="page-head">
    <div>
      <div class="row gap-8"><Icon name="list" size={16} /><h2>名单管理</h2></div>
      <p class="muted sm">黑名单直接拦截、白名单放行、观察名单只用于评分与解释。规则通过 <code class="mono">in_list(字段, "名单ID")</code> 引用。</p>
    </div>
    <button class="btn primary" onclick={() => (showNew = true)}><Icon name="plus" size={14} /> 新建名单</button>
  </div>

  <div class="layout">
    <aside class="list-side card">
      <div class="list-controls">
        <div class="search">
          <Icon name="search" size={13} />
          <input bind:value={query} placeholder="搜索名单" />
        </div>
        <div class="tabbar">
          <button class={filterKind === 'all' ? 'active' : ''} onclick={() => (filterKind = 'all')}>全部</button>
          <button class={filterKind === 'black' ? 'active' : ''} onclick={() => (filterKind = 'black')}>黑</button>
          <button class={filterKind === 'white' ? 'active' : ''} onclick={() => (filterKind = 'white')}>白</button>
          <button class={filterKind === 'watch' ? 'active' : ''} onclick={() => (filterKind = 'watch')}>观察</button>
        </div>
      </div>
      <div class="list-items scroll-y">
        {#each filtered as l (l.id)}
          <button class="list-card {l.id === selectedId ? 'selected' : ''}" onclick={() => (selectedId = l.id)}>
            <div class="row gap-8">
              <span class="chip {kindMeta[l.kind].chip} tiny">{kindMeta[l.kind].label}</span>
              <span class="lname">{l.label}</span>
            </div>
            <div class="row gap-8 tiny faint" style="margin-top:3px">
              <span class="mono">{l.id}</span>
              <span>·</span>
              <span>{entityLabel[l.entity_type]}</span>
              <span class="spacer"></span>
              <span class="mono">{l.entries.length} 条</span>
            </div>
          </button>
        {/each}
        {#if filtered.length === 0}
          <div class="empty tiny">无匹配名单</div>
        {/if}
      </div>
    </aside>

    {#if selected}
      <section class="detail card">
        <div class="card-header">
          <div class="card-title">
            <span class="chip {kindMeta[selected.kind].chip}">{kindMeta[selected.kind].label}</span>
            <input class="label-input" value={selected.label} oninput={(e) => { selected.label = (e.target as HTMLInputElement).value; markDirty(); }} />
            <span class="mono tiny faint">{selected.id}</span>
          </div>
          <div class="row gap-8">
            <label class="kind-selector">
              <span class="tiny muted">类型</span>
              <select value={selected.kind} onchange={(e) => { selected.kind = (e.target as HTMLSelectElement).value as ListKind; markDirty(); }}>
                <option value="black">黑名单</option>
                <option value="white">白名单</option>
                <option value="watch">观察名单</option>
              </select>
            </label>
            <button class="btn sm ghost" onclick={exportList} title="导出 JSON"><Icon name="download" size={13} /></button>
            <button class="btn sm danger" onclick={deleteList} title="删除名单"><Icon name="trash" size={13} /></button>
          </div>
        </div>

        <div class="detail-body">
          <div class="meta-row">
            <div class="meta-item">
              <span class="kpi-label">实体类型</span>
              <span class="sm">{entityLabel[selected.entity_type]}</span>
            </div>
            <div class="meta-item">
              <span class="kpi-label">条目数</span>
              <span class="sm mono">{selected.entries.length}</span>
            </div>
            <div class="meta-item">
              <span class="kpi-label">被引用</span>
              <span class="sm">{(usageByList.get(selected.id) ?? []).length} 条规则</span>
            </div>
            <div class="meta-item">
              <span class="kpi-label">更新时间</span>
              <span class="sm">{new Date(selected.updated_at || Date.now()).toLocaleDateString('zh-CN')}</span>
            </div>
          </div>

          {#if selected.description}
            <p class="desc muted sm">{selected.description}</p>
          {/if}

          {#if (usageByList.get(selected.id) ?? []).length}
            <div class="usage">
              <span class="tiny faint">引用规则：</span>
              {#each usageByList.get(selected.id) ?? [] as u}
                <span class="chip gray tiny">{u.name}</span>
              {/each}
            </div>
          {/if}

          <div class="add-entries">
            <textarea
              bind:value={entryText}
              rows="3"
              placeholder="每行一个，或用逗号/分号分隔批量粘贴。例如：{selected.entity_type === 'card' ? 'C4539X3F0001' : selected.entity_type === 'device' ? 'CT-0D' : selected.entity_type === 'ip' ? '10.12.0.5' : 'CU9A01'}"
              onkeydown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') addEntries(); }}
            ></textarea>
            <div class="row" style="justify-content:space-between;margin-top:7px">
              <span class="tiny faint">⌘/Ctrl + Enter 快速添加 · 已自动去重</span>
              <button class="btn sm primary" onclick={addEntries} disabled={!entryText.trim()}>
                <Icon name="plus" size={13} /> 添加 {parseEntries(entryText).length || ''} 条
              </button>
            </div>
          </div>

          <div class="entries card">
            <div class="entries-head">
              <span class="kpi-label">名单条目</span>
              <span class="spacer"></span>
              <span class="tiny faint">显示 {filteredEntries.length} / {entries.length}</span>
            </div>
            <div class="entries-list scroll-y">
              {#each filteredEntries as e (e)}
                <div class="entry">
                  <span class="mono">{e}</span>
                  <button class="btn ghost icon" onclick={() => removeEntry(e)} title="移除"><Icon name="x" size={12} /></button>
                </div>
              {/each}
              {#if entries.length === 0}
                <div class="empty tiny">名单为空，粘贴条目后添加</div>
              {/if}
            </div>
          </div>
        </div>
      </section>
    {:else}
      <div class="empty card" style="padding:60px"><Icon name="list" size={30} /> 选择或新建一个名单</div>
    {/if}
  </div>
</div>

<Modal open={showNew} title="新建名单" subtitle="名单 ID 会在 DSL 中引用，创建后不可修改" onclose={() => (showNew = false)} width={500}>
  <div class="col gap-12">
    <div class="row gap-12">
      <label class="col gap-4" style="flex:1">
        <span class="tiny muted">显示名称</span>
        <input bind:value={draft.label} placeholder="例如：已知盗刷卡" />
      </label>
      <label class="col gap-4" style="flex:1">
        <span class="tiny muted">名单 ID（英文）</span>
        <input bind:value={draft.id} placeholder="blacklist_cards" class="mono" />
      </label>
    </div>
    <div class="row gap-12">
      <label class="col gap-4" style="flex:1">
        <span class="tiny muted">类型</span>
        <select bind:value={draft.kind}>
          <option value="black">黑名单（拦截）</option>
          <option value="white">白名单（放行）</option>
          <option value="watch">观察名单</option>
        </select>
      </label>
      <label class="col gap-4" style="flex:1">
        <span class="tiny muted">实体类型</span>
        <select bind:value={draft.entity_type}>
          <option value="card">卡哈希</option>
          <option value="device">设备 ID</option>
          <option value="ip">IP</option>
          <option value="customer">客户 ID</option>
          <option value="email">邮箱哈希</option>
          <option value="phone">手机号哈希</option>
        </select>
      </label>
    </div>
    <label class="col gap-4">
      <span class="tiny muted">说明（可选）</span>
      <textarea bind:value={draft.description} rows="2"></textarea>
    </label>
    <div class="row gap-8" style="justify-content:flex-end">
      <button class="btn sm" onclick={() => (showNew = false)}>取消</button>
      <button class="btn sm primary" onclick={createList}>创建</button>
    </div>
  </div>
</Modal>

<style>
  .page { height: 100%; overflow-y: auto; padding: 16px 20px 32px; }
  .page-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; margin-bottom: 14px; }
  h2 { margin: 0; font-size: 18px; font-weight: 650; }
  .page-head p { margin: 5px 0 0; max-width: 760px; }
  .page-head code { background: rgba(91,140,255,0.1); padding: 1px 5px; border-radius: 4px; color: #93c5fd; font-size: 11px; }
  .layout { display: grid; grid-template-columns: 300px minmax(0, 1fr); gap: 12px; align-items: start; }
  .list-side { display: flex; flex-direction: column; }
  .list-controls { padding: 10px; display: flex; flex-direction: column; gap: 8px; border-bottom: 1px solid var(--border); }
  .search { display: flex; align-items: center; gap: 6px; background: var(--bg); border: 1px solid var(--border); border-radius: 7px; padding: 0 8px; color: var(--text-faint); }
  .search input { border: none; background: transparent; padding: 6px 0; flex: 1; font-size: 12px; box-shadow: none; }
  .search input:focus { box-shadow: none; }
  .list-items { padding: 8px; max-height: calc(100vh - 240px); }
  .list-card { display: flex; flex-direction: column; width: 100%; text-align: left; padding: 8px 10px; border: 1px solid transparent; border-radius: 8px; background: transparent; color: var(--text); margin-bottom: 3px; }
  .list-card:hover { background: var(--bg-hover); }
  .list-card.selected { background: rgba(91,140,255,0.1); border-color: rgba(91,140,255,0.3); }
  .lname { font-size: 12.5px; font-weight: 600; }
  .detail { display: flex; flex-direction: column; }
  .detail-body { padding: 14px 16px; display: flex; flex-direction: column; gap: 14px; }
  .label-input { font-size: 14px; font-weight: 600; background: transparent; border-color: transparent; padding: 2px 6px; min-width: 180px; }
  .label-input:hover { border-color: var(--border); }
  .label-input:focus { background: var(--bg-elev-2); }
  .kind-selector { display: flex; align-items: center; gap: 6px; }
  .kind-selector select { padding: 4px 8px; }
  .meta-row { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; }
  .meta-item { display: flex; flex-direction: column; gap: 3px; }
  .desc { margin: 0; }
  .usage { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .add-entries textarea { width: 100%; font-family: var(--mono); font-size: 12px; resize: vertical; }
  .entries { display: flex; flex-direction: column; }
  .entries-head { display: flex; align-items: center; padding: 9px 12px; border-bottom: 1px solid var(--border); }
  .entries-list { max-height: 280px; display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 2px; padding: 8px; }
  .entry { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 4px 6px 4px 10px; border-radius: 6px; font-size: 11.5px; }
  .entry:hover { background: var(--bg-hover); }
  .entry .btn { opacity: 0; }
  .entry:hover .btn { opacity: 1; }
</style>
