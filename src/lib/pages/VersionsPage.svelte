<script lang="ts">
  import { app, versionSnapshot, restoreVersion, diffCounts, toast, markDirty } from '../state/store.svelte';
  import Icon from '../components/Icon.svelte';
  import Modal from '../components/Modal.svelte';
  import type { RuleVersion, RulePackage } from '../types';

  let showPublish = $state(false);
  let publishName = $state('');
  let publishNote = $state('');
  let previewVersion = $state<RuleVersion | null>(null);
  let compareVersion = $state<RuleVersion | null>(null);
  let confirmRollback = $state<RuleVersion | null>(null);

  const current = $derived(app.versions.find((v) => v.id === app.currentVersionId) ?? null);

  function publish() {
    const seq = app.versions[0] ? app.versions[0].seq + 1 : 1;
    const v = versionSnapshot(publishName.trim() || `策略更新 v${seq}`, publishNote.trim() || '手动发布');
    showPublish = false;
    publishName = '';
    publishNote = '';
    toast('success', `已发布 v${v.seq}，共 ${app.package.rules.length} 条规则`);
  }

  function doRollback() {
    if (!confirmRollback) return;
    const target = confirmRollback;
    restoreVersion(target.id);
    confirmRollback = null;
    toast('success', `已回滚到 v${target.seq}「${target.name}」，生成新的版本记录`);
  }

  function fmt(ts: number): string {
    const d = new Date(ts);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function rulesChanged(a: RulePackage, b: RulePackage): Array<{ kind: 'added' | 'removed' | 'modified'; name: string; id: string }> {
    const out: Array<{ kind: 'added' | 'removed' | 'modified'; name: string; id: string }> = [];
    const mapB = new Map(b.rules.map((r) => [r.id, r]));
    for (const r of a.rules) {
      const other = mapB.get(r.id);
      if (!other) out.push({ kind: 'added', name: r.name, id: r.id });
      else if (JSON.stringify(r) !== JSON.stringify(other)) out.push({ kind: 'modified', name: r.name, id: r.id });
    }
    for (const other of b.rules) if (!a.rules.some((r) => r.id === other.id)) out.push({ kind: 'removed', name: other.name, id: other.id });
    return out;
  }

  const compareChanges = $derived(compareVersion ? rulesChanged(app.package, compareVersion.package) : []);
</script>

<div class="page">
  <div class="page-head">
    <div>
      <div class="row gap-8"><Icon name="history" size={16} /><h2>版本与回滚</h2></div>
      <p class="muted sm">每次发布都会保存规则、名单和分组的完整快照。回滚会基于目标版本生成一个新版本，历史永不丢失。</p>
    </div>
    <div class="row gap-8">
      {#if app.dirty}<span class="chip amber"><Icon name="alert" size={11} /> 有未发布改动</span>{/if}
      <button class="btn primary" onclick={() => { publishName = `策略更新 v${app.versions[0]?.seq ? app.versions[0].seq + 1 : 1}`; showPublish = true; }}>
        <Icon name="upload" size={14} /> 发布当前版本
      </button>
    </div>
  </div>

  {#if current}
    <div class="current card">
      <div class="card-body row" style="gap:16px;align-items:center">
        <div class="current-badge">v{current.seq}</div>
        <div class="col" style="flex:1">
          <div class="row gap-8">
            <span style="font-weight:600">{current.name}</span>
            <span class="chip green tiny">当前生效</span>
          </div>
          <span class="tiny muted">{current.note} · {fmt(current.created_at)} · {current.author}</span>
        </div>
        <div class="current-stats">
          <div><span class="mono">{current.package.rules.length}</span><span class="tiny faint"> 规则</span></div>
          <div><span class="mono">{current.package.lists.length}</span><span class="tiny faint"> 名单</span></div>
          <div><span class="mono">{current.package.groups.length}</span><span class="tiny faint"> 分组</span></div>
        </div>
        {#if app.dirty}
          <span class="tiny amber">本地有改动未发布</span>
        {/if}
      </div>
    </div>
  {/if}

  <div class="timeline">
    {#each app.versions as v, i (v.id)}
      <div class="version card {v.id === app.currentVersionId ? 'active' : ''}">
        <div class="v-left">
          <div class="v-seq mono">v{v.seq}</div>
          <div class="v-line"></div>
        </div>
        <div class="v-body">
          <div class="v-head">
            <div class="col" style="min-width:0">
              <div class="row gap-8">
                <span class="v-name">{v.name}</span>
                {#if v.id === app.currentVersionId}<span class="chip green tiny">当前</span>{/if}
                {#if v.rolled_back_from}<span class="chip amber tiny">回滚</span>{/if}
                {#if i === 0}<span class="chip blue tiny">最新</span>{/if}
              </div>
              <span class="tiny muted">{v.note}</span>
            </div>
            <span class="spacer"></span>
            <span class="tiny faint">{fmt(v.created_at)} · {v.author}</span>
          </div>
          <div class="v-meta">
            <span class="mono tiny">{v.package.rules.length} 规则</span>
            <span class="mono tiny">{v.package.lists.length} 名单</span>
            <span class="mono tiny">{v.package.groups.length} 分组</span>
            <span class="spacer"></span>
            <button class="btn sm ghost" onclick={() => (previewVersion = v)}><Icon name="eye" size={12} /> 查看</button>
            {#if i > 0}
              <button class="btn sm ghost" onclick={() => (compareVersion = v)}><Icon name="scale" size={12} /> 与当前对比</button>
            {/if}
            {#if v.id !== app.currentVersionId}
              <button class="btn sm" onclick={() => (confirmRollback = v)}><Icon name="rotate" size={12} /> 回滚到此版本</button>
            {/if}
          </div>
        </div>
      </div>
    {/each}
    {#if app.versions.length === 0}
      <div class="empty card"><Icon name="history" size={28} /> 还没有发布记录，点击右上角发布第一个版本</div>
    {/if}
  </div>
</div>

<Modal open={showPublish} title="发布新版本" subtitle="将当前所有规则、名单与分组保存为快照" onclose={() => (showPublish = false)} width={480}>
  <div class="col gap-12">
    <label class="col gap-4">
      <span class="tiny muted">版本名称</span>
      <input bind:value={publishName} />
    </label>
    <label class="col gap-4">
      <span class="tiny muted">变更说明</span>
      <textarea bind:value={publishNote} rows="3" placeholder="例如：上线卡测规则 R103，观察名单新增 3 个设备"></textarea>
    </label>
    <div class="summary-line tiny muted">
      本次包含 {app.package.rules.length} 条规则 · {app.package.lists.length} 个名单 · {app.package.groups.length} 个分组
    </div>
    <div class="row gap-8" style="justify-content:flex-end">
      <button class="btn sm" onclick={() => (showPublish = false)}>取消</button>
      <button class="btn sm primary" onclick={publish}><Icon name="upload" size={13} /> 发布</button>
    </div>
  </div>
</Modal>

<Modal open={confirmRollback !== null} title="确认回滚" subtitle={confirmRollback ? `将回滚到 v${confirmRollback.seq}「${confirmRollback.name}」` : ''} onclose={() => (confirmRollback = null)} width={480}>
  {#if confirmRollback}
    <div class="col gap-12">
      <div class="warn-box">
        <Icon name="alert" size={15} />
        <div>
          <div class="sm" style="font-weight:600">当前未发布的改动会丢失</div>
          <div class="tiny muted">回滚会生成一个新版本，原历史版本保持不变，可随时再次切换。</div>
        </div>
      </div>
      <div class="diff-summary">
        <div class="tiny faint" style="margin-bottom:6px">与当前工作区相比：</div>
        <div class="row gap-12 tiny">
          <span>规则：{diffCounts(confirmRollback.package).rules} 处差异</span>
          <span>名单：{diffCounts(confirmRollback.package).lists} 处差异</span>
          <span>分组：{diffCounts(confirmRollback.package).groups} 处差异</span>
        </div>
      </div>
      <div class="row gap-8" style="justify-content:flex-end">
        <button class="btn sm" onclick={() => (confirmRollback = null)}>取消</button>
        <button class="btn sm primary" onclick={doRollback}><Icon name="rotate" size={13} /> 确认回滚</button>
      </div>
    </div>
  {/if}
</Modal>

<Modal open={previewVersion !== null} title={previewVersion ? `v${previewVersion.seq} · ${previewVersion.name}` : ''} onclose={() => (previewVersion = null)} width={640}>
  {#if previewVersion}
    <div class="col gap-12">
      <div class="tiny muted">{previewVersion.note}</div>
      <div class="preview-list scroll-y">
        {#each previewVersion.package.groups as g}
          <div class="pg-group">
            <div class="row gap-8">
              <span class="group-dot" style="background:{g.color ?? '#5b8cff'}"></span>
              <span class="sm" style="font-weight:600">{g.name}</span>
              <span class="mono tiny faint">P{g.priority}</span>
              {#if !g.enabled}<span class="chip gray tiny">停用</span>{/if}
            </div>
            {#each previewVersion.package.rules.filter((r) => r.group_id === g.id) as r}
              <div class="pg-rule">
                <span class="mono tiny faint">{r.id}</span>
                <span class="sm">{r.name}</span>
                <span class="spacer"></span>
                <span class="chip {r.mode === 'enforce' ? 'green' : 'violet'} tiny">{r.mode === 'enforce' ? `拦截${r.rollout < 100 ? ' ' + r.rollout + '%' : ''}` : '影子'}</span>
              </div>
            {/each}
          </div>
        {/each}
      </div>
    </div>
  {/if}
</Modal>

<Modal open={compareVersion !== null} title={compareVersion ? `当前工作区 vs v${compareVersion.seq}` : ''} onclose={() => (compareVersion = null)} width={620}>
  {#if compareVersion}
    <div class="col gap-8">
      {#if compareChanges.length === 0}
        <div class="empty tiny">规则完全一致</div>
      {:else}
        {#each compareChanges as c}
          <div class="change">
            <span class="chip {c.kind === 'added' ? 'green' : c.kind === 'removed' ? 'red' : 'amber'} tiny">
              {c.kind === 'added' ? '新增' : c.kind === 'removed' ? '删除' : '修改'}
            </span>
            <span class="sm">{c.name}</span>
            <span class="mono tiny faint">{c.id}</span>
          </div>
        {/each}
      {/if}
    </div>
  {/if}
</Modal>

<style>
  .page { height: 100%; overflow-y: auto; padding: 16px 20px 32px; max-width: 980px; }
  .page-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; margin-bottom: 14px; }
  h2 { margin: 0; font-size: 18px; font-weight: 650; }
  .page-head p { margin: 5px 0 0; }
  .current { margin-bottom: 16px; border-color: rgba(52,211,153,0.25); }
  .current-badge { font-family: var(--mono); font-size: 16px; font-weight: 700; color: var(--green); background: var(--green-soft); padding: 8px 12px; border-radius: 9px; }
  .current-stats { display: flex; gap: 16px; }
  .current-stats > div { display: flex; flex-direction: column; align-items: center; gap: 1px; }
  .amber { color: var(--amber); }
  .timeline { display: flex; flex-direction: column; gap: 8px; }
  .version { display: flex; gap: 12px; padding: 12px 14px; }
  .version.active { border-color: rgba(52,211,153,0.3); background: rgba(52,211,153,0.03); }
  .v-left { display: flex; flex-direction: column; align-items: center; gap: 6px; padding-top: 2px; }
  .v-seq { font-size: 11px; font-weight: 700; color: var(--text-dim); background: var(--bg); padding: 3px 7px; border-radius: 6px; }
  .v-line { flex: 1; width: 1px; background: var(--border); }
  .v-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
  .v-head { display: flex; align-items: flex-start; gap: 10px; }
  .v-name { font-weight: 600; font-size: 13px; }
  .v-meta { display: flex; align-items: center; gap: 12px; }
  .v-meta .mono { color: var(--text-faint); }
  .summary-line { padding: 8px 10px; background: var(--bg); border-radius: 7px; }
  .warn-box { display: flex; gap: 10px; padding: 10px 12px; background: var(--amber-soft); border: 1px solid rgba(251,191,36,0.25); border-radius: 8px; color: var(--amber); }
  .warn-box .sm, .warn-box .tiny { color: var(--text); }
  .diff-summary { padding: 10px 12px; background: var(--bg); border-radius: 8px; }
  .preview-list { max-height: 420px; display: flex; flex-direction: column; gap: 12px; }
  .pg-group { display: flex; flex-direction: column; gap: 5px; }
  .group-dot { width: 7px; height: 7px; border-radius: 2px; }
  .pg-rule { display: flex; align-items: center; gap: 8px; padding: 4px 0 4px 15px; }
  .change { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 6px; }
  .change:hover { background: var(--bg-hover); }
</style>
