<script lang="ts">
  import { untrack } from 'svelte';
  import type { Rule, RuleList, RuleGroup, Action, Severity, RuleMode } from '../types';
  import { compileRule, type CompiledRule } from '../dsl/compiler';
  import DslEditor from './DslEditor.svelte';
  import Diagnostics from './Diagnostics.svelte';
  import ExprHelpers from './ExprHelpers.svelte';
  import Icon from './Icon.svelte';

  interface Props {
    rule: Rule;
    groups: RuleGroup[];
    lists: RuleList[];
    onchange: (patch: Partial<Rule>) => void;
    onsave: () => void;
    onclose: () => void;
    ondelete: () => void;
  }
  let { rule, groups, lists, onchange, onsave, onclose, ondelete }: Props = $props();

  // The parent keys this component by rule id, so each rule gets a fresh instance
  // and the local edit buffers never straddle two rules.
  // Capture the initial values on purpose: the parent keys this component by
  // rule id, so a new rule mounts a new instance rather than mutating this one.
  let expr = $state(untrack(() => rule.expression));
  let showHelpers = $state(true);
  let tab = $state<'logic' | 'action' | 'meta'>('logic');

  let compiled: CompiledRule = $derived(
    compileRule({ ...rule, expression: expr }, { lists: new Map(lists.map((l) => [l.id, l])) }),
  );
  let hasErrors = $derived(compiled.diagnostics.some((d) => d.severity === 'error'));

  function updateExpr(next: string) {
    expr = next;
    onchange({ expression: next, updated_at: Date.now() });
  }

  function insertSnippet(text: string) {
    const el = document.querySelector<HTMLTextAreaElement>('.editor textarea');
    if (!el) {
      updateExpr(expr ? `${expr} and ${text}` : text);
      return;
    }
    const start = el.selectionStart ?? expr.length;
    const end = el.selectionEnd ?? expr.length;
    const before = expr.slice(0, start);
    const after = expr.slice(end);
    const needsSpace = before.length > 0 && !/\s$/.test(before);
    const next = before + (needsSpace ? ' ' : '') + text + after;
    updateExpr(next);
    requestAnimationFrame(() => {
      const pos = start + (needsSpace ? 1 : 0) + text.length;
      el.focus();
      el.selectionStart = el.selectionEnd = pos;
    });
  }

  const ACTION_LABELS: Record<Action, string> = {
    block: '拦截',
    challenge: '二次验证',
    review: '人工审核',
    record: '仅记录',
    allow: '放行（白名单）',
  };
  const SEVERITY_LABELS: Record<Severity, string> = {
    low: '低',
    medium: '中',
    high: '高',
    critical: '严重',
  };
  const MODE_LABELS: Record<RuleMode, string> = {
    off: '停用',
    shadow: '影子（只记录）',
    enforce: '生效',
  };

  let tagsText = $state(untrack(() => rule.tags.join(', ')));
</script>

<div class="editor-page">
  <div class="head">
    <div class="title-block">
      <div class="row gap-8">
        <input
          class="name-input"
          value={rule.name}
          oninput={(e) => onchange({ name: (e.target as HTMLInputElement).value })}
          placeholder="规则名称"
        />
        <span class="chip gray tiny mono">{rule.id}</span>
        {#if hasErrors}
          <span class="chip red tiny"><Icon name="alert" size={11} /> 语法错误</span>
        {:else}
          <span class="chip green tiny"><Icon name="check" size={11} /> 编译通过 · {compiled.conditionCount} 个条件</span>
        {/if}
      </div>
      <div class="sub muted sm">
        {groups.find((g) => g.id === rule.group_id)?.name ?? '未分组'} · 优先级 {rule.priority}
        {#if compiled.aggregates.length}
          · {compiled.aggregates.length} 个滑动窗口
        {/if}
        {#if compiled.listsUsed.length}
          · 引用 {compiled.listsUsed.length} 个名单
        {/if}
      </div>
    </div>
    <div class="row gap-8">
      <label class="toggle-row" title="启用/停用整条规则">
        <input
          type="checkbox"
          checked={rule.enabled}
          onchange={(e) => onchange({ enabled: (e.target as HTMLInputElement).checked })}
        />
        <span class="sm">启用</span>
      </label>
      <button class="btn sm" onclick={onclose}>返回列表</button>
      <button class="btn sm primary" onclick={onsave} disabled={hasErrors}>
        <Icon name="save" size={13} /> 保存
      </button>
    </div>
  </div>

  <div class="tabbar self">
    <button class={tab === 'logic' ? 'active' : ''} onclick={() => (tab = 'logic')}>逻辑</button>
    <button class={tab === 'action' ? 'active' : ''} onclick={() => (tab = 'action')}>动作与灰度</button>
    <button class={tab === 'meta' ? 'active' : ''} onclick={() => (tab = 'meta')}>元信息</button>
  </div>

  <div class="body">
    {#if tab === 'logic'}
      <div class="logic-grid">
        <div class="col gap-8">
          <div class="label-row">
            <span class="kpi-label">规则表达式 (DSL)</span>
            <span class="tiny faint">Ctrl/⌘ + Enter 保存 · 支持拖动右下角调整高度</span>
          </div>
          <DslEditor value={expr} diagnostics={compiled.diagnostics} onchange={updateExpr} onsubmit={onsave} minHeight={180} />
          <Diagnostics diagnostics={compiled.diagnostics} />

          {#if compiled.aggregates.length > 0}
            <div class="aggregates card">
              <div class="card-header">
                <div class="card-title"><Icon name="clock" size={13} /> 滑动窗口</div>
                <span class="tiny faint">引擎为每个窗口维护增量状态，O(log n) 分批</span>
              </div>
              <div class="agg-list">
                {#each compiled.aggregates as agg}
                  <div class="agg">
                    <span class="chip blue tiny mono">{agg.kind}</span>
                    <div class="agg-body">
                      <div class="agg-label">{agg.label}</div>
                      <div class="agg-meta mono">
                        窗口 {agg.windowLabel} · 键 {agg.keyFields.join(' + ')}
                        {#if agg.measure && agg.measure.kind === 'field'} · 统计字段 {agg.measure.name}{/if}
                      </div>
                    </div>
                  </div>
                {/each}
              </div>
            </div>
          {/if}

          <div class="hint-card">
            <div class="hint-title"><Icon name="code" size={13} /> 语法速查</div>
            <div class="syntax">
              <code>count(10m, card_hash) &gt;= 5</code><span>同卡 10 分钟笔数</span>
              <code>sum(amount_usd, 10m, card_hash) &gt; 5000</code><span>同卡 10 分钟金额</span>
              <code>distinct(card_hash, 1h, ip) &gt;= 6</code><span>同 IP 关联卡数</span>
              <code>count(1h, ip where amount_usd &lt; 5)</code><span>带过滤的窗口</span>
              <code>in_list(card_hash, "blacklist_cards")</code><span>名单命中</span>
              <code>a and (b or not c)</code><span>布尔组合</span>
            </div>
          </div>
        </div>

        {#if showHelpers}
          <div class="helpers-col">
            <div class="helpers-head">
              <span class="kpi-label">插入</span>
              <button class="btn ghost icon" onclick={() => (showHelpers = false)} title="收起">
                <Icon name="chevronRight" size={14} />
              </button>
            </div>
            <ExprHelpers oninsert={insertSnippet} />
          </div>
        {:else}
          <button class="btn ghost expand" onclick={() => (showHelpers = true)} title="展开函数/字段">
            <Icon name="chevronRight" size={14} />
          </button>
        {/if}
      </div>
    {:else if tab === 'action'}
      <div class="form-grid">
        <div class="form-field">
          <label class="kpi-label" for="rule-group">所属分组</label>
          <select id="rule-group" value={rule.group_id} onchange={(e) => onchange({ group_id: (e.target as HTMLSelectElement).value })}>
            {#each [...groups].sort((a, b) => b.priority - a.priority) as g}
              <option value={g.id}>{g.name}（优先级 {g.priority}）</option>
            {/each}
          </select>
          <span class="help">分组的优先级高于规则内部优先级，先按分组排序。</span>
        </div>

        <div class="form-field">
          <label class="kpi-label" for="rule-priority">规则优先级</label>
          <input id="rule-priority" type="number" value={rule.priority} oninput={(e) => onchange({ priority: Number((e.target as HTMLInputElement).value) })} />
          <span class="help">数字越小越先评估；同一交易只拦最高优先级的一条。</span>
        </div>

        <div class="form-field">
          <label class="kpi-label" for="rule-mode">模式</label>
          <select id="rule-mode" value={rule.mode} onchange={(e) => onchange({ mode: (e.target as HTMLSelectElement).value as RuleMode })}>
            {#each Object.entries(MODE_LABELS) as [k, v]}
              <option value={k}>{v}</option>
            {/each}
          </select>
          <span class="help">影子模式只记录命中，不影响真实放行决策。</span>
        </div>

        <div class="form-field">
          <label class="kpi-label" for="rule-rollout">灰度比例</label>
          <div class="row gap-8">
            <input id="rule-rollout" type="range" min="0" max="100" step="5" value={rule.rollout} oninput={(e) => onchange({ rollout: Number((e.target as HTMLInputElement).value) })} style="flex:1" />
            <span class="mono sm" style="width:42px;text-align:right">{rule.rollout}%</span>
          </div>
          <span class="help">按卡哈希稳定分桶，同一张卡永远落在同一实验组，避免同一客户反复横跳。</span>
        </div>

        <div class="form-field">
          <label class="kpi-label" for="rule-action">命中动作</label>
          <select id="rule-action" value={rule.action} onchange={(e) => onchange({ action: (e.target as HTMLSelectElement).value as Action })}>
            {#each Object.entries(ACTION_LABELS) as [k, v]}
              <option value={k}>{v}</option>
            {/each}
          </select>
        </div>

        <div class="form-field">
          <label class="kpi-label" for="rule-severity">风险等级</label>
          <select id="rule-severity" value={rule.severity} onchange={(e) => onchange({ severity: (e.target as HTMLSelectElement).value as Severity })}>
            {#each Object.entries(SEVERITY_LABELS) as [k, v]}
              <option value={k}>{v}</option>
            {/each}
          </select>
        </div>
      </div>

      <div class="preview card">
        <div class="card-header"><div class="card-title"><Icon name="eye" size={13} /> 灰度效果预览</div></div>
        <div class="card-body">
          <div class="rollout-preview">
            <div class="rp-bar">
              <div class="rp-enforce" style="width:{rule.mode === 'enforce' ? rule.rollout : 0}%"></div>
            </div>
            <div class="row gap-12 tiny muted" style="margin-top:8px">
              <span class="row gap-4"><span class="swatch enforce"></span> 生效拦截 {rule.mode === 'enforce' ? rule.rollout : 0}%</span>
              <span class="row gap-4"><span class="swatch shadow"></span> 影子记录 {rule.mode === 'enforce' ? 100 - rule.rollout : 100}%</span>
            </div>
          </div>
        </div>
      </div>
    {:else}
      <div class="form-grid">
        <div class="form-field full">
          <label class="kpi-label" for="rule-reason">命中说明</label>
          <textarea
            id="rule-reason"
            rows="3"
            value={rule.reason}
            oninput={(e) => onchange({ reason: (e.target as HTMLTextAreaElement).value })}
            placeholder="给审核同学看的解释：这条规则为什么存在、命中后该怎么处理"
          ></textarea>
        </div>

        <div class="form-field">
          <label class="kpi-label" for="rule-tags">标签</label>
          <input id="rule-tags" value={tagsText} oninput={(e) => {
            tagsText = (e.target as HTMLInputElement).value;
            onchange({ tags: tagsText.split(',').map((t: string) => t.trim()).filter(Boolean) });
          }} placeholder="用逗号分隔，例如：窗口, 关联" />
        </div>

        <div class="form-field">
          <div class="kpi-label">引用</div>
          <div class="refs">
            {#if compiled.fieldsUsed.length}
              <div class="tiny faint">字段</div>
              <div class="row gap-4 wrap">{#each compiled.fieldsUsed as f}<span class="chip gray tiny mono">{f}</span>{/each}</div>
            {/if}
            {#if compiled.listsUsed.length}
              <div class="tiny faint" style="margin-top:6px">名单</div>
              <div class="row gap-4 wrap">{#each compiled.listsUsed as l}<span class="chip blue tiny mono">{l}</span>{/each}</div>
            {/if}
          </div>
        </div>
      </div>

      <div class="danger-zone card">
        <div class="card-body row" style="justify-content:space-between">
          <div>
            <div class="sm" style="font-weight:600">删除规则</div>
            <div class="tiny muted">删除后需通过版本历史恢复。</div>
          </div>
          <button class="btn sm danger" onclick={ondelete}><Icon name="trash" size={13} /> 删除</button>
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .editor-page {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    padding: 14px 18px 0;
    gap: 10px;
  }
  .head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
  .title-block { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
  .name-input {
    font-size: 16px;
    font-weight: 650;
    background: transparent;
    border: 1px solid transparent;
    padding: 3px 6px;
    min-width: 280px;
  }
  .name-input:hover { border-color: var(--border); }
  .name-input:focus { background: var(--bg-elev-2); }
  .toggle-row { display: flex; align-items: center; gap: 6px; cursor: pointer; user-select: none; }
  .toggle-row input { accent-color: var(--accent); }
  .tabbar.self { align-self: flex-start; }
  .body { flex: 1; min-height: 0; overflow-y: auto; padding-bottom: 20px; }

  .logic-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 268px;
    gap: 14px;
    align-items: start;
  }
  .label-row { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }

  .aggregates { margin-top: 4px; }
  .agg-list { padding: 8px 12px 12px; display: flex; flex-direction: column; gap: 6px; }
  .agg { display: flex; gap: 9px; align-items: flex-start; padding: 6px 0; border-bottom: 1px solid rgba(30,41,63,0.5); }
  .agg:last-child { border-bottom: none; }
  .agg-body { display: flex; flex-direction: column; gap: 2px; }
  .agg-label { font-size: 12px; font-weight: 550; }
  .agg-meta { font-size: 10.5px; color: var(--text-faint); }

  .hint-card { background: var(--bg-elev); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 12px 14px; }
  .hint-title { display: flex; align-items: center; gap: 7px; font-size: 12px; font-weight: 600; margin-bottom: 8px; color: var(--text-dim); }
  .syntax { display: grid; grid-template-columns: minmax(0, auto) 1fr; gap: 5px 14px; align-items: baseline; }
  .syntax code {
    font-family: var(--mono);
    font-size: 11px;
    color: #93c5fd;
    background: rgba(91,140,255,0.07);
    padding: 2px 7px;
    border-radius: 5px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .syntax span { font-size: 11px; color: var(--text-dim); }

  .helpers-col {
    position: sticky;
    top: 0;
    height: calc(100vh - 230px);
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
  }
  .helpers-head { display: flex; align-items: center; justify-content: space-between; }
  .expand { align-self: start; height: 60px; }

  .form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; max-width: 900px; padding-top: 14px; }
  .form-field { display: flex; flex-direction: column; gap: 6px; }
  .form-field.full { grid-column: 1 / -1; }
  .help { font-size: 11px; color: var(--text-faint); line-height: 1.4; }
  textarea { resize: vertical; }
  .preview { margin-top: 20px; max-width: 700px; }
  .rollout-preview { padding: 4px 0; }
  .rp-bar { height: 10px; border-radius: 999px; background: rgba(167,139,250,0.2); overflow: hidden; display: flex; }
  .rp-enforce { background: linear-gradient(90deg, #34d399, #22d3ee); transition: width 0.25s; }
  .swatch { width: 8px; height: 8px; border-radius: 2px; display: inline-block; }
  .swatch.enforce { background: var(--green); }
  .swatch.shadow { background: var(--violet); }
  .refs { display: flex; flex-direction: column; gap: 3px; }
  .wrap { flex-wrap: wrap; }
  .danger-zone { margin-top: 20px; max-width: 560px; border-color: rgba(248,113,113,0.25); }
</style>
