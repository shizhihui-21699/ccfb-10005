<script lang="ts">
  import { app, compileAll, findGroup, markDirty, toast } from '../state/store.svelte';
  import type { Rule, RuleGroup } from '../types';
  import Icon from '../components/Icon.svelte';
  import RuleEditor from '../components/RuleEditor.svelte';
  import ModeBadge from '../components/ModeBadge.svelte';
  import Modal from '../components/Modal.svelte';

  let selectedId = $state<string | null>(app.package.rules[0]?.id ?? null);
  let query = $state('');
  let filterGroup = $state<string>('all');
  let collapsed = $state<Set<string>>(new Set());
  let showNew = $state(false);
  let newName = $state('');
  let newGroup = $state(app.package.groups[0]?.id ?? '');
  let showGroupEditor = $state(false);
  let editingGroup = $state<RuleGroup | null>(null);
  let groupDraft = $state({ name: '', priority: 500, description: '', color: '#5b8cff' });

  $effect(() => {
    if (!app.draftRule) return;
    const draft = app.draftRule;
    const id = `R${String(Date.now()).slice(-6)}`;
    const rule: Rule = {
      id,
      name: draft.name ?? '来自团伙分析的规则',
      group_id: app.package.groups.find((g) => g.id === 'g_linkage')?.id ?? app.package.groups[0].id,
      priority: 40,
      enabled: true,
      mode: draft.mode ?? 'shadow',
      rollout: 0,
      action: draft.action ?? 'review',
      severity: draft.severity ?? 'high',
      expression: draft.expression,
      reason: '根据关联分析发现的团伙基础设施生成，先影子观察。',
      tags: ['关联分析'],
      updated_at: Date.now(),
    };
    app.package.rules.push(rule);
    selectedId = id;
    app.draftRule = null;
    markDirty();
    toast('info', '已从团伙线索创建草稿规则（影子模式）');
  });

  const compiled = $derived(compileAll(app.package));
  const selected = $derived(app.package.rules.find((r) => r.id === selectedId) ?? null);

  const errorsByRule = $derived.by(() => {
    const map = new Map<string, number>();
    for (const [id, c] of compiled) {
      const errs = c.diagnostics.filter((d) => d.severity === 'error').length;
      if (errs) map.set(id, errs);
    }
    return map;
  });

  const groupedRules = $derived.by(() => {
    const groups = [...app.package.groups].sort((a, b) => b.priority - a.priority);
    return groups.map((g) => ({
      group: g,
      rules: app.package.rules
        .filter((r) => r.group_id === g.id)
        .filter((r) => {
          if (query && !r.name.toLowerCase().includes(query.toLowerCase()) && !r.expression.toLowerCase().includes(query.toLowerCase()) && !r.id.toLowerCase().includes(query.toLowerCase())) return false;
          return true;
        })
        .sort((a, b) => a.priority - b.priority),
    }));
  });

  const visibleGroups = $derived(
    groupedRules.filter((g) => (filterGroup === 'all' || g.group.id === filterGroup) && (g.rules.length > 0 || !query)),
  );

  function toggleGroup(id: string) {
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    collapsed = next;
  }

  function patchRule(patch: Partial<Rule>) {
    const rule = app.package.rules.find((r) => r.id === selectedId);
    if (!rule) return;
    Object.assign(rule, patch);
    markDirty();
  }

  function saveRule() {
    markDirty();
    toast('success', '规则已保存（未发布，发布后生效）');
  }

  function addRule() {
    const id = `R${String(Date.now()).slice(-6)}`;
    const rule: Rule = {
      id,
      name: newName.trim() || '未命名规则',
      group_id: newGroup,
      priority: 50,
      enabled: true,
      mode: 'shadow',
      rollout: 0,
      action: 'review',
      severity: 'medium',
      expression: 'amount_usd > 1000',
      reason: '',
      tags: [],
      updated_at: Date.now(),
    };
    app.package.rules.push(rule);
    selectedId = id;
    showNew = false;
    newName = '';
    markDirty();
    toast('info', '已创建规则，默认为影子模式');
  }

  function deleteRule() {
    if (!selectedId) return;
    const idx = app.package.rules.findIndex((r) => r.id === selectedId);
    if (idx < 0) return;
    const name = app.package.rules[idx].name;
    app.package.rules.splice(idx, 1);
    selectedId = app.package.rules[Math.min(idx, app.package.rules.length - 1)]?.id ?? null;
    markDirty();
    toast('warn', `已删除规则「${name}」`);
  }

  function duplicateRule(rule: Rule) {
    const id = `R${String(Date.now()).slice(-6)}`;
    const copy = JSON.parse(JSON.stringify(rule)) as Rule;
    copy.id = id;
    copy.name = `${rule.name} 副本`;
    copy.priority = rule.priority + 5;
    copy.mode = 'shadow';
    copy.rollout = 0;
    copy.updated_at = Date.now();
    app.package.rules.push(copy);
    selectedId = id;
    markDirty();
  }

  function toggleGroupEnabled(g: RuleGroup) {
    g.enabled = !g.enabled;
    markDirty();
  }

  function openGroupEditor(g: RuleGroup) {
    editingGroup = g;
    groupDraft = { name: g.name, priority: g.priority, description: g.description, color: g.color ?? '#5b8cff' };
    showGroupEditor = true;
  }

  function saveGroup() {
    if (!editingGroup) return;
    Object.assign(editingGroup, groupDraft);
    showGroupEditor = false;
    markDirty();
    toast('success', '分组已更新');
  }

  function addGroup() {
    const id = `g_${Date.now().toString(36).slice(-5)}`;
    app.package.groups.push({ id, name: '新分组', priority: 450, enabled: true, description: '', color: '#5b8cff' });
    markDirty();
  }

  const actionLabel: Record<string, string> = { block: '拦截', challenge: '验证', review: '审核', record: '记录', allow: '放行' };
  const severityColor: Record<string, string> = {
    critical: 'var(--red)', high: 'var(--amber)', medium: 'var(--accent)', low: 'var(--text-faint)',
  };
</script>

<div class="page">
  <aside class="sidebar">
    <div class="side-head">
      <div class="row gap-8">
        <Icon name="layers" size={14} />
        <span class="side-title">规则与分组</span>
      </div>
      <button class="btn sm primary" onclick={() => { showNew = true; newGroup = visibleGroups[0]?.group.id ?? app.package.groups[0]?.id; }}>
        <Icon name="plus" size={13} /> 新建
      </button>
    </div>

    <div class="side-controls">
      <div class="search">
        <Icon name="search" size={13} />
        <input bind:value={query} placeholder="搜索规则名 / 表达式 / ID" />
      </div>
      <select bind:value={filterGroup} class="sm" style="width:100%">
        <option value="all">全部分组（{app.package.rules.length} 条）</option>
        {#each [...app.package.groups].sort((a, b) => b.priority - a.priority) as g}
          <option value={g.id}>{g.name}（{app.package.rules.filter((r) => r.group_id === g.id).length}）</option>
        {/each}
      </select>
    </div>

    <div class="tree scroll-y">
      {#each visibleGroups as { group, rules } (group.id)}
        <div class="group-block">
          <div class="group-head" class:disabled={!group.enabled}>
            <button class="chev" onclick={() => toggleGroup(group.id)} aria-label="展开分组">
              <Icon name={collapsed.has(group.id) ? 'chevronRight' : 'chevronDown'} size={13} />
            </button>
            <span class="group-dot" style="background:{group.color ?? '#5b8cff'}"></span>
            <span class="group-name" role="button" tabindex="0" onclick={() => openGroupEditor(group)} onkeydown={(e) => e.key === 'Enter' && openGroupEditor(group)}>{group.name}</span>
            <span class="tiny faint mono">{group.priority}</span>
            <span class="spacer"></span>
            <label class="mini-toggle" title={group.enabled ? '停用分组' : '启用分组'}>
              <input type="checkbox" checked={group.enabled} onchange={() => toggleGroupEnabled(group)} />
            </label>
          </div>
          {#if !collapsed.has(group.id)}
            {#each rules as rule (rule.id)}
              <button
                class="rule-item {rule.id === selectedId ? 'selected' : ''}"
                onclick={() => (selectedId = rule.id)}
              >
                <div class="ri-top">
                  <span class="ri-name">{rule.name}</span>
                  {#if errorsByRule.has(rule.id)}
                    <span class="err-dot" title="语法错误"></span>
                  {/if}
                </div>
                <div class="ri-meta">
                  <span class="mono tiny faint">P{rule.priority}</span>
                  <span class="sev-dot" style="background:{severityColor[rule.severity]}"></span>
                  <span class="tiny muted">{actionLabel[rule.action]}</span>
                  <ModeBadge mode={rule.mode} rollout={rule.rollout} />
                  {#if !rule.enabled}<span class="chip gray tiny">停用</span>{/if}
                </div>
              </button>
            {/each}
            {#if rules.length === 0}
              <div class="empty-group tiny faint">（该分组暂无匹配规则）</div>
            {/if}
          {/if}
        </div>
      {/each}
      <button class="btn ghost sm add-group" onclick={addGroup}><Icon name="plus" size={12} /> 新建分组</button>
    </div>
  </aside>

  <section class="editor-area">
    {#if selected}
      {#key selected.id}
      <RuleEditor
        rule={selected}
        groups={app.package.groups}
        lists={app.package.lists}
        onchange={patchRule}
        onsave={saveRule}
        onclose={() => (selectedId = null)}
        ondelete={deleteRule}
      />
      {/key}
    {:else}
      <div class="empty">
        <Icon name="rules" size={34} />
        <div>选择左侧规则开始编辑</div>
        <button class="btn sm" onclick={() => duplicateRule(app.package.rules[0])}>复制第一条规则试试</button>
      </div>
    {/if}
  </section>
</div>

<Modal open={showNew} title="新建规则" subtitle="新规则默认以影子模式创建，先观察再拦截" onclose={() => (showNew = false)}>
  <div class="col gap-12">
    <label class="col gap-4">
      <span class="tiny muted">规则名称</span>
      <input bind:value={newName} placeholder="例如：同卡 10 分钟高频大额" />
    </label>
    <label class="col gap-4">
      <span class="tiny muted">所属分组</span>
      <select bind:value={newGroup}>
        {#each [...app.package.groups].sort((a, b) => b.priority - a.priority) as g}
          <option value={g.id}>{g.name}</option>
        {/each}
      </select>
    </label>
    <div class="row gap-8" style="justify-content:flex-end;margin-top:6px">
      <button class="btn sm" onclick={() => (showNew = false)}>取消</button>
      <button class="btn sm primary" onclick={addRule}>创建</button>
    </div>
  </div>
</Modal>

<Modal open={showGroupEditor} title="编辑分组" subtitle="分组优先级决定评估顺序" onclose={() => (showGroupEditor = false)} width={480}>
  <div class="col gap-12">
    <label class="col gap-4">
      <span class="tiny muted">名称</span>
      <input bind:value={groupDraft.name} />
    </label>
    <div class="row gap-12">
      <label class="col gap-4" style="flex:1">
        <span class="tiny muted">分组优先级（越大越先）</span>
        <input type="number" bind:value={groupDraft.priority} />
      </label>
      <label class="col gap-4">
        <span class="tiny muted">颜色</span>
        <input type="color" bind:value={groupDraft.color} style="width:60px;padding:2px;height:34px" />
      </label>
    </div>
    <label class="col gap-4">
      <span class="tiny muted">说明</span>
      <textarea rows="2" bind:value={groupDraft.description}></textarea>
    </label>
    <div class="row gap-8" style="justify-content:flex-end">
      <button class="btn sm" onclick={() => (showGroupEditor = false)}>取消</button>
      <button class="btn sm primary" onclick={saveGroup}>保存</button>
    </div>
  </div>
</Modal>

<style>
  .page { display: grid; grid-template-columns: 292px minmax(0, 1fr); height: 100%; min-height: 0; }
  .sidebar {
    display: flex;
    flex-direction: column;
    border-right: 1px solid var(--border);
    min-height: 0;
    background: #0a0f1a;
  }
  .side-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 12px 10px;
    border-bottom: 1px solid var(--border);
  }
  .side-title { font-size: 12.5px; font-weight: 600; }
  .side-controls { padding: 10px 12px; display: flex; flex-direction: column; gap: 7px; border-bottom: 1px solid var(--border); }
  .search {
    display: flex; align-items: center; gap: 6px;
    background: var(--bg); border: 1px solid var(--border);
    border-radius: 7px; padding: 0 8px; color: var(--text-faint);
  }
  .search input { border: none; background: transparent; padding: 6px 0; flex: 1; font-size: 12px; box-shadow: none; }
  .search input:focus { box-shadow: none; }
  .tree { flex: 1; min-height: 0; padding: 8px; }
  .group-block { margin-bottom: 6px; }
  .group-head {
    display: flex; align-items: center; gap: 6px;
    padding: 4px 4px;
    border-radius: 6px;
  }
  .group-head.disabled { opacity: 0.45; }
  .group-head:hover { background: rgba(23, 32, 52, 0.6); }
  .chev { background: none; border: none; padding: 0; color: var(--text-faint); display: flex; }
  .group-dot { width: 7px; height: 7px; border-radius: 2px; flex-shrink: 0; }
  .group-name { font-size: 12px; font-weight: 600; cursor: pointer; }
  .group-name:hover { color: var(--accent); }
  .mini-toggle input { width: 12px; height: 12px; accent-color: var(--accent); cursor: pointer; }
  .rule-item {
    display: flex; flex-direction: column; gap: 3px;
    width: 100%; text-align: left;
    padding: 6px 8px 6px 24px;
    background: transparent; border: 1px solid transparent;
    border-radius: 7px; color: var(--text);
  }
  .rule-item:hover { background: var(--bg-hover); }
  .rule-item.selected { background: rgba(91,140,255,0.11); border-color: rgba(91,140,255,0.3); }
  .ri-top { display: flex; align-items: center; gap: 6px; }
  .ri-name { font-size: 12px; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .err-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--red); flex-shrink: 0; }
  .ri-meta { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
  .sev-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
  .empty-group { padding: 6px 0 8px 24px; }
  .add-group { margin: 4px 0 0 4px; color: var(--text-dim); }
  .editor-area { min-width: 0; min-height: 0; overflow: hidden; }
</style>
