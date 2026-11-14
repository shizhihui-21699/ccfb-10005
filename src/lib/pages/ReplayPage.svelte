<script lang="ts">
  import { app, versionSnapshot, toast, markDirty } from '../state/store.svelte';
  import { analysisClient } from '../state/workers';
  import { dataset } from '../state/dataset.svelte';
  import { importCsv, csvTemplate } from '../data/importer';
  import type { DatasetSummary } from '../data/schema';
  import type { ReplaySummary, ReplaySample } from '../engine/replay';
  import Icon from '../components/Icon.svelte';
  import Kpi from '../components/Kpi.svelte';
  import Histogram from '../components/Histogram.svelte';
  import Explanation from '../components/Explanation.svelte';
  import Modal from '../components/Modal.svelte';
  import type { ExplainNode } from '../dsl/compiler';

  let result = $state<ReplaySummary | null>(null);
  let progress = $state<{ processed: number; total: number; rps?: number; phase: string } | null>(null);
  let busy = $state(false);
  let error = $state<string | null>(null);
  let takeMs = $state(0);
  const summary = $derived(dataset.summary);
  let selectedSample = $state<ReplaySample | null>(null);
  let showSample = $state(false);
  let tab = $state<'overview' | 'rules' | 'samples' | 'breakdown'>('overview');
  let sortKey = $state<'hits' | 'precision' | 'recall' | 'fraudHits'>('hits');
  let onlyActive = $state(true);
  let uploading = $state(false);
  let uploadWarnings = $state<string[]>([]);
  let fileInput = $state<HTMLInputElement | null>(null);

  async function onFile(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    uploading = true;
    uploadWarnings = [];
    error = null;
    try {
      const text = await file.text();
      const parsed = importCsv(text, `上传 · ${file.name}`);
      if (parsed.dataset.summary.n === 0) throw new Error('文件中没有可用交易行');
      await client.load(parsed.dataset.summary, parsed.dataset.cols);
      uploadWarnings = parsed.warnings;
      result = null;
      toast('success', `已加载 ${parsed.dataset.summary.n.toLocaleString('en-US')} 笔交易（${file.name}）`);
    } catch (err) {
      error = (err as Error).message;
      toast('error', `导入失败：${(err as Error).message}`);
    } finally {
      uploading = false;
      input.value = '';
    }
  }

  function downloadTemplate() {
    const blob = new Blob([csvTemplate()], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sentinel-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  const client = analysisClient();

  async function generate() {
    busy = true;
    error = null;
    progress = { processed: 0, total: dataset.size, phase: 'generate' };
    try {
      const res = await client.generate(dataset.size, dataset.seed, dataset.days, (msg) => {
        progress = { processed: msg.processed, total: msg.total, phase: msg.phase, note: msg.note } as typeof progress;
      });
      takeMs = res.takeMs;
      result = null;
      toast('success', `已生成 ${res.summary.n.toLocaleString('en-US')} 笔交易（${res.takeMs}ms）`);
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = false;
      progress = null;
    }
  }

  async function runReplay() {
    if (!summary) {
      toast('warn', '请先生成或加载数据');
      return;
    }
    busy = true;
    error = null;
    result = null;
    progress = { processed: 0, total: summary.n, phase: 'replay' };
    try {
      const res = await client.replay(app.package, app.package.rules.map((r) => ({
        id: r.id, name: r.name, expression: r.expression, group_id: r.group_id,
      })), (msg) => {
        progress = {
          processed: msg.processed,
          total: msg.total,
          phase: msg.phase,
          rps: msg.rowsPerSecond,
        };
      });
      result = res;
      toast('success', `回放完成：${res.processed.toLocaleString('en-US')} 笔 / ${(res.elapsedMs / 1000).toFixed(2)}s`);
    } catch (e) {
      error = (e as Error).message;
      toast('error', `回放失败：${(e as Error).message}`);
    } finally {
      busy = false;
      progress = null;
    }
  }

  const sortedStats = $derived.by(() => {
    if (!result) return [];
    const list = [...result.ruleStats].filter((s) => (onlyActive ? s.hits > 0 : true));
    const cmp: Record<string, (a: typeof list[0], b: typeof list[0]) => number> = {
      hits: (a, b) => b.hits - a.hits,
      precision: (a, b) => b.precision - a.precision,
      recall: (a, b) => b.recall - a.recall,
      fraudHits: (a, b) => b.fraudHits - a.fraudHits,
    };
    return list.sort(cmp[sortKey]);
  });

  const hourBuckets = $derived.by(() => {
    if (!result) return [];
    const hours = new Array(24).fill(0);
    for (const s of result.samples) hours[new Date(s.row.ts as number).getUTCHours()]++;
    return hours.map((v, i) => ({ label: String(i).padStart(2, '0'), value: v }));
  });

  const reasonFrequency = $derived.by(() => {
    if (!result) return [];
    const counts = new Map<string, number>();
    for (const s of result.samples) {
      for (const h of s.hits) {
        for (const r of h.reasons.slice(0, 2)) {
          const key = r.split('（')[0];
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  });

  const decisionEntries = $derived.by(() =>
    Object.entries(result?.finalDecisions ?? {}).map(([k, v]) => [k, Number(v)] as [string, number]),
  );
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  const num = (v: number) => v.toLocaleString('en-US');
  const usd = (v: number) => '$' + v.toLocaleString('en-US');

  function severityChip(s: string): string {
    return s === 'critical' ? 'red' : s === 'high' ? 'amber' : s === 'medium' ? 'blue' : 'gray';
  }

  function fmtTime(ts: number): string {
    const d = new Date(ts);
    return `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  }

  function openSample(s: ReplaySample) {
    selectedSample = s;
    showSample = true;
  }

</script>

<div class="page">
  <div class="page-head">
    <div>
      <div class="row gap-8">
        <Icon name="play" size={16} />
        <h2>历史回放</h2>
        {#if result}
          <span class="chip green tiny">{num(result.processed)} 笔已回放</span>
        {/if}
      </div>
      <p class="muted sm">用线上历史交易重放当前规则，衡量命中率、误杀与灰度影响。所有计算在 Web Worker 中完成，页面不阻塞。</p>
    </div>
    <div class="row gap-8">
      <button class="btn" onclick={generate} disabled={busy || uploading}>
        <Icon name="database" size={14} /> {summary ? '重新生成数据' : '生成演示数据'}
      </button>
      <button class="btn" onclick={() => fileInput?.click()} disabled={busy || uploading} title="导入自己的 CSV 交易数据">
        {#if uploading}<span class="spinner"></span>{:else}<Icon name="upload" size={14} />{/if} 导入 CSV
      </button>
      <input bind:this={fileInput} type="file" accept=".csv,.tsv,.txt" style="display:none" onchange={onFile} />
      <button class="btn primary" onclick={runReplay} disabled={busy || !summary}>
        {#if busy}<span class="spinner"></span>{:else}<Icon name="play" size={14} />{/if}
        {busy ? '回放中…' : '运行回放'}
      </button>
    </div>
  </div>

  {#if error}
    <div class="alert red"><Icon name="alert" size={14} /> {error}</div>
  {/if}
  {#if uploadWarnings.length}
    <div class="alert amber">
      <Icon name="info" size={14} />
      <div>{#each uploadWarnings as w}<div>{w}</div>{/each}</div>
    </div>
  {/if}

  {#if progress && busy}
    <div class="progress-card card">
      <div class="card-body">
        <div class="row" style="justify-content:space-between;margin-bottom:8px">
          <span class="sm">
            {progress.phase === 'generate' ? '正在生成演示数据…' : progress.phase === 'replay' ? '正在回放交易…' : '分析中…'}
          </span>
          <span class="mono tiny muted">
            {#if progress.phase === 'replay'}
              {num(progress.processed)} / {num(progress.total)} · {progress.rps ? num(progress.rps) + ' 笔/秒' : ''}
            {:else}
              {num(progress.total)} 笔
            {/if}
          </span>
        </div>
        <div class="bar"><span style="width:{progress.phase === 'generate' ? 100 : (progress.processed / Math.max(1, progress.total)) * 100}%"></span></div>
      </div>
    </div>
  {/if}

  {#if !summary}
    <div class="setup card">
      <div class="card-body setup-body">
        <div class="setup-icon"><Icon name="database" size={26} /></div>
        <div class="setup-text">
          <h3>还没有数据集</h3>
          <p class="muted sm">生成一份带 5 个已知欺诈团伙标签的 20 万笔演示交易，用来验证规则与回放效果。也可以直接导出后替换为你的线上数据。</p>
          <div class="setup-controls">
            <label class="col gap-4">
              <span class="tiny muted">规模</span>
              <select bind:value={dataset.size}>
                <option value={20000}>2 万笔（极快）</option>
                <option value={50000}>5 万笔</option>
                <option value={200000}>20 万笔（推荐）</option>
                <option value={500000}>50 万笔</option>
              </select>
            </label>
            <label class="col gap-4">
              <span class="tiny muted">随机种子</span>
              <input type="number" bind:value={dataset.seed} style="width:130px" />
            </label>
            <label class="col gap-4">
              <span class="tiny muted">天数</span>
              <input type="number" bind:value={dataset.days} style="width:90px" />
            </label>
            <button class="btn primary" onclick={generate} disabled={busy}>
              <Icon name="sparkles" size={14} /> 生成并加载
            </button>
            <button class="btn" onclick={() => fileInput?.click()} disabled={uploading}>
              <Icon name="upload" size={14} /> 导入 CSV
            </button>
          </div>
          <div class="import-hint">
            <span class="tiny faint">CSV 需包含列：ts、amount_usd（或 amount）、card_hash、device_id、ip、customer_id。</span>
            <button class="link tiny" onclick={downloadTemplate}>下载模板</button>
          </div>
        </div>
      </div>
    </div>
  {/if}

  {#if summary && !result}
    <div class="dataset-strip card">
      <div class="card-body">
        <div class="ds-grid">
          <div class="ds-item">
            <span class="kpi-label">数据集</span>
            <span class="ds-value">{num(summary.n)} 笔</span>
            <span class="tiny faint">{new Date(summary.startedAt).toISOString().slice(0, 10)} → {new Date(summary.endedAt).toISOString().slice(0, 10)}</span>
          </div>
          <div class="ds-item">
            <span class="kpi-label">交易总额</span>
            <span class="ds-value">{usd(summary.totalAmountUsd)}</span>
            <span class="tiny faint">{summary.countries} 个国家 · {summary.merchants} 商户</span>
          </div>
          <div class="ds-item">
            <span class="kpi-label">实体规模</span>
            <span class="ds-value">{num(summary.customers)} 客户</span>
            <span class="tiny faint">{num(summary.cards)} 卡 · {num(summary.devices)} 设备 · {num(summary.ips)} IP</span>
          </div>
          <div class="ds-item">
            <span class="kpi-label">已知欺诈</span>
            <span class="ds-value red">{num(summary.fraudulent)} 笔</span>
            <span class="tiny faint">{summary.ringCount} 个团伙 · {summary.notes}</span>
          </div>
        </div>
        {#if summary.rings.length}
          <div class="ring-row">
            {#each summary.rings as r}
              <div class="ring-pill" style="border-color:{r.color}55">
                <span class="ring-dot" style="background:{r.color}"></span>
                <span class="sm">{r.name}</span>
                <span class="tiny mono faint">{num(r.txns)} 笔 · {usd(r.amountUsd)}</span>
              </div>
            {/each}
          </div>
        {/if}
        <div class="ready-hint">
          <Icon name="info" size={13} />
          数据已就绪，点击右上角「运行回放」用当前 {app.package.rules.length} 条规则重放。
        </div>
      </div>
    </div>
  {/if}

  {#if result}
    {#if result.hasLabels}
      <div class="kpis">
        <Kpi label="命中率 Precision" value={pct(result.precision)} tone="green" icon="target"
          sub={`${num(result.fraudCaught)} 次正确拦截 / ${num(result.enforcedHits)} 次拦截`} />
        <Kpi label="召回率 Recall" value={pct(result.recall)} tone="violet" icon="gauge"
          sub={`捕获 ${num(result.fraudCaught)} / ${num(result.fraudRows)} 笔欺诈`} />
        <Kpi label="误杀" value={num(result.falsePositives)} tone={result.falsePositives > 100 ? 'red' : 'amber'} icon="alert"
          sub={`误拦金额 ${usd(result.blockedLegitAmountUsd)}`} />
        <Kpi label="命中次数" value={num(result.totalHits)} sub={`生效 ${num(result.enforcedHits)} · 影子 ${num(result.shadowHits)}`} icon="zap" />
        <Kpi label="回放速度" value={num(result.rowsPerSecond)} sub={`${num(result.processed)} 笔 / ${(result.elapsedMs / 1000).toFixed(2)}s`} tone="green" icon="clock" />
        <Kpi label="避免损失" value={usd(result.blockedFraudAmountUsd)} tone="green" icon="shield"
          sub={`团伙 ${num(result.fraudCaughtByRing)} · 单人 ${num(result.fraudCaughtBySolo)}`} />
      </div>
    {:else}
      <div class="noleak">
        <Icon name="info" size={14} />
        当前数据集没有真实标签，无法计算命中率与误杀。以下为命中量与决策分布，可用于核对规则行为。
      </div>
      <div class="kpis">
        <Kpi label="命中次数" value={num(result.totalHits)} sub={`生效 ${num(result.enforcedHits)} · 影子 ${num(result.shadowHits)}`} icon="zap" />
        <Kpi label="拦截决策" value={num(result.finalDecisions.block ?? 0)} tone="red" icon="shield" sub={`审核 ${num(result.finalDecisions.review ?? 0)} · 验证 ${num(result.finalDecisions.challenge ?? 0)}`} />
        <Kpi label="放行" value={num(result.finalDecisions.allow ?? 0)} tone="green" icon="check" sub={`共 ${num(result.processed)} 笔`} />
        <Kpi label="回放速度" value={num(result.rowsPerSecond)} sub={`${num(result.processed)} 笔 / ${(result.elapsedMs / 1000).toFixed(2)}s`} tone="violet" icon="clock" />
      </div>
    {/if}

    <div class="result-bar">
      <div class="tabbar">
        <button class={tab === 'overview' ? 'active' : ''} onclick={() => (tab = 'overview')}>总览</button>
        <button class={tab === 'rules' ? 'active' : ''} onclick={() => (tab = 'rules')}>规则表现</button>
        <button class={tab === 'breakdown' ? 'active' : ''} onclick={() => (tab = 'breakdown')}>决策分布</button>
        <button class={tab === 'samples' ? 'active' : ''} onclick={() => (tab = 'samples')}>命中样本 ({result.samples.length})</button>
      </div>
      <div class="spacer"></div>
      <button class="btn sm" onclick={() => { versionSnapshot('回放后快照', `回放 ${num(result!.processed)} 笔，精确率 ${pct(result!.precision)}`); toast('success', '已保存为新的版本快照'); }}>
        <Icon name="save" size={13} /> 保存为版本
      </button>
    </div>

    {#if tab === 'overview'}
      <div class="overview-grid">
        <div class="card">
          <div class="card-header">
            <div class="card-title"><Icon name="gauge" size={13} /> 拦截构成</div>
          </div>
          <div class="card-body">
            <div class="stack-bar">
              {#each decisionEntries as [action, count] (action)}
                {#if count > 0}
                  <div
                    class="stack-seg"
                    style="width:{(count / result.processed) * 100}%;background:{action === 'allow' ? '#26344d' : action === 'block' ? 'var(--red)' : action === 'challenge' ? 'var(--amber)' : action === 'review' ? 'var(--violet)' : '#22d3ee'}"
                    title="{action}: {num(count)}"
                  ></div>
                {/if}
              {/each}
            </div>
            <div class="legend">
              {#each decisionEntries as [action, count] (action)}
                {#if count > 0}
                  <span class="legend-item">
                    <span class="swatch" style="background:{action === 'allow' ? '#26344d' : action === 'block' ? 'var(--red)' : action === 'challenge' ? 'var(--amber)' : action === 'review' ? 'var(--violet)' : '#22d3ee'}"></span>
                    {action === 'allow' ? '放行' : action === 'block' ? '拦截' : action === 'challenge' ? '二次验证' : action === 'review' ? '人工审核' : action}
                    <span class="mono tiny muted">{num(count)}</span>
                  </span>
                {/if}
              {/each}
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <div class="card-title"><Icon name="clock" size={13} /> 命中时间分布（UTC）</div>
            <span class="tiny faint">样本 {result.samples.length} 条</span>
          </div>
          <div class="card-body">
            <Histogram buckets={hourBuckets} height={72} color="#7c5cff" />
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <div class="card-title"><Icon name="filter" size={13} /> 触发条件排名</div>
          </div>
          <div class="card-body">
            {#if reasonFrequency.length === 0}
              <div class="muted sm">暂无样本</div>
            {:else}
              <div class="reason-list">
                {#each reasonFrequency as [reason, count]}
                  <div class="reason">
                    <span class="reason-label">{reason}</span>
                    <div class="reason-bar"><span style="width:{(count / reasonFrequency[0][1]) * 100}%"></span></div>
                    <span class="mono tiny faint">{count}</span>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        </div>

        <div class="card">
          <div class="card-header"><div class="card-title"><Icon name="network" size={13} /> 团伙覆盖</div></div>
          <div class="card-body">
            <div class="coverage">
              <div class="cov-row">
                <span class="sm">团伙欺诈</span>
                <span class="mono">{num(result.fraudCaughtByRing)}</span>
                <span class="tiny faint">非团伙（单人盗刷）{num(result.fraudCaughtBySolo)} 笔被捕获</span>
              </div>
              <div class="bar" style="margin:6px 0 2px">
                <span style="width:{result.fraudRows ? (result.fraudCaughtByRing / result.fraudRows) * 100 : 0}%;background:var(--violet)"></span>
              </div>
              <div class="tiny faint">按规则决策捕获的欺诈中，团伙占比 {result.fraudCaught ? pct(result.fraudCaughtByRing / result.fraudCaught) : '—'}</div>
            </div>
            <div class="divider" style="margin:12px 0"></div>
            <div class="tiny muted">
              误杀 {num(result.falsePositives)} 笔，约 {pct(result.falsePositives / Math.max(1, result.legitRows))} 的正常交易。
              建议将高误杀规则保持影子模式，或用灰度比例限制影响面。
            </div>
          </div>
        </div>
      </div>
    {:else if tab === 'rules'}
      <div class="rules-table card">
        <div class="table-tools">
          <label class="toggle-row"><input type="checkbox" bind:checked={onlyActive} /> 只看有命中的规则</label>
          <span class="spacer"></span>
          <span class="tiny faint">按</span>
          <select bind:value={sortKey} class="sm">
            <option value="hits">命中次数</option>
            <option value="fraudHits">命中欺诈数</option>
            <option value="precision">精确率</option>
            <option value="recall">召回率</option>
          </select>
        </div>
        <div class="table-scroll scroll-y">
          <table class="data">
            <thead>
              <tr>
                <th>规则</th>
                <th>分组</th>
                <th>模式</th>
                <th class="num">命中</th>
                <th class="num">欺诈命中</th>
                <th class="num">误杀</th>
                <th class="num">精确率</th>
                <th class="num">召回率</th>
                <th class="num">涉及金额</th>
              </tr>
            </thead>
            <tbody>
              {#each sortedStats as s (s.ruleId)}
                <tr>
                  <td>
                    <div class="rule-cell">
                      <span class="chip {severityChip(s.severity)} tiny">{s.action}</span>
                      <span class="rule-name">{s.ruleName}</span>
                      <span class="mono tiny faint">{s.ruleId}</span>
                    </div>
                  </td>
                  <td class="sm muted">{s.groupName}</td>
                  <td>
                    {#if s.mode === 'enforce'}
                      {#if s.enforcedHits > 0 && s.shadowHits > 0}
                        <span class="chip amber tiny">灰度</span>
                        <div class="tiny faint mono mode-split">{num(s.enforcedHits)} 生效 / {num(s.shadowHits)} 影子</div>
                      {:else}
                        <span class="chip green tiny">生效</span>
                      {/if}
                    {:else}
                      <span class="chip violet tiny">影子</span>
                    {/if}
                  </td>
                  <td class="num mono">{num(s.hits)}</td>
                  <td class="num mono">{num(s.fraudHits)}</td>
                  <td class="num mono" class:bad={s.action !== 'allow' && s.legitHits > s.fraudHits}>{num(s.legitHits)}</td>
                  <td class="num">
                    {#if s.action === 'allow'}
                      <span class="tiny faint">—</span>
                    {:else}
                      <span class="pct-cell {s.precision > 0.8 ? 'good' : s.precision > 0.5 ? 'mid' : 'bad'}">{s.hits ? pct(s.precision) : '—'}</span>
                    {/if}
                  </td>
                  <td class="num mono tiny">{s.action === 'allow' ? '—' : s.hits ? pct(s.recall) : '—'}</td>
                  <td class="num mono tiny">{usd(Math.round(s.amountAtRisk))}</td>
                </tr>
              {/each}
            </tbody>
          </table>
          {#if sortedStats.length === 0}
            <div class="empty"><Icon name="search" size={22} /> 没有规则命中</div>
          {/if}
        </div>
      </div>
    {:else if tab === 'breakdown'}
      <div class="breakdown-grid">
        {#each result.breakdown as b}
          <div class="bd-card card">
            <div class="bd-head">
              <span class="sm" style="font-weight:600">{b.ruleName}</span>
              <span class="mono tiny faint">{b.ruleId}</span>
            </div>
            <div class="bd-bar">
              <div class="bd-fraud" style="width:{(b.fraud / Math.max(1, b.fraud + b.legit)) * 100}%"></div>
            </div>
            <div class="bd-meta">
              <span class="chip green tiny">正确 {num(b.fraud)}</span>
              <span class="chip red tiny">误杀 {num(b.legit)}</span>
              <span class="spacer"></span>
              <span class="tiny faint">{pct(b.fraud / Math.max(1, b.fraud + b.legit))} 精确</span>
            </div>
          </div>
        {/each}
      </div>
    {:else}
      <div class="samples card">
        <div class="table-scroll scroll-y">
          <table class="data">
            <thead>
              <tr>
                <th>时间</th>
                <th>金额</th>
                <th>卡 / 设备 / IP</th>
                <th>命中规则</th>
                {#if result.hasLabels}<th>真值</th>{/if}
                <th>触发条件</th>
              </tr>
            </thead>
            <tbody>
              {#each result.samples.slice(0, 200) as s}
                <tr class="clickable" onclick={() => openSample(s)}>
                  <td class="mono tiny">{fmtTime(s.ts)}</td>
                  <td class="mono">${(s.row.amount_usd as number).toFixed(2)}</td>
                  <td class="tiny mono">
                    <div>{s.row.card_hash}</div>
                    <div class="faint">{s.row.device_id} · {s.row.ip}</div>
                  </td>
                  <td>
                    <div class="row gap-4" style="flex-wrap:wrap">
                      {#each s.hits.slice(0, 2) as h}
                        <span class="chip {h.shadow ? 'violet' : 'green'} tiny">{h.ruleName}</span>
                      {/each}
                      {#if s.hits.length > 2}<span class="tiny faint">+{s.hits.length - 2}</span>{/if}
                    </div>
                  </td>
                  {#if result.hasLabels}
                    <td>
                      {#if s.truth.is_fraud}
                        <span class="chip red tiny">{s.truth.ring ?? '单人盗刷'}</span>
                      {:else}
                        <span class="chip gray tiny">正常</span>
                      {/if}
                    </td>
                  {/if}
                  <td class="tiny muted reasons-cell">{s.hits[0]?.reasons.slice(0, 2).join('；') ?? '—'}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </div>
    {/if}
  {/if}
</div>

<Modal open={showSample} title="命中解释" subtitle={selectedSample ? `${fmtTime(selectedSample.ts)} · $${(selectedSample.row.amount_usd as number).toFixed(2)} · ${selectedSample.row.card_hash}` : ''} width={640} onclose={() => (showSample = false)}>
  {#if selectedSample}
    <div class="col gap-12">
      <div class="row gap-8" style="flex-wrap:wrap">
        {#if result?.hasLabels}
          {#if selectedSample.truth.is_fraud}
            <span class="chip red">真实欺诈 · {selectedSample.truth.ring ?? '单人盗刷'}</span>
          {:else}
            <span class="chip gray">真实正常</span>
            {#if selectedSample.finalAction !== 'allow'}<span class="chip amber">这是一次误杀</span>{/if}
          {/if}
        {:else}
          <span class="chip gray">无标签</span>
        {/if}
        <span class="chip {selectedSample.finalAction === 'allow' ? 'gray' : 'green'}">决策：{selectedSample.finalAction}</span>
      </div>

      <div class="txn-fields">
        {#each [
          ['商户', selectedSample.row.merchant_name],
          ['MCC', selectedSample.row.mcc],
          ['通道', selectedSample.row.channel],
          ['国家 / 城市', `${selectedSample.row.country} · ${selectedSample.row.city}`],
          ['IP 国家', selectedSample.row.ip_country],
          ['设备', selectedSample.row.device_id],
          ['客户账龄', `${selectedSample.row.customer_tenure_days} 天`],
          ['卡龄', `${selectedSample.row.card_tenure_days} 天`],
          ['3DS', selectedSample.row.is_3ds ? '是' : '否'],
        ] as [label, value]}
          <div class="tf"><span class="tf-label">{label}</span><span class="tf-value">{value}</span></div>
        {/each}
      </div>

      {#each selectedSample.hits as h}
        <div class="hit-block">
          <div class="row gap-8">
            <span class="chip {h.shadow ? 'violet' : 'green'} tiny">{h.shadow ? '影子' : '生效'}</span>
            <span style="font-weight:600">{h.ruleName}</span>
            <span class="mono tiny faint">{h.ruleId}</span>
            <span class="spacer"></span>
            <span class="tiny faint">{h.groupName}</span>
          </div>
          {#if h.reasons.length}
            <ul class="reasons">{#each h.reasons as r}<li>{r}</li>{/each}</ul>
          {/if}
        </div>
      {/each}

      {#if selectedSample.explanation}
        <div>
          <div class="kpi-label" style="margin-bottom:6px">条件求值树（{selectedSample.finalAction === 'allow' ? '首个生效规则' : '决策规则'}）</div>
          <Explanation node={selectedSample.explanation as ExplainNode} />
        </div>
      {/if}
    </div>
  {/if}
</Modal>

<style>
  .page { height: 100%; overflow-y: auto; padding: 16px 20px 32px; }
  .page-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; margin-bottom: 14px; }
  h2 { margin: 0; font-size: 18px; font-weight: 650; }
  .page-head p { margin: 5px 0 0; max-width: 720px; }

  .alert { display: flex; align-items: center; gap: 8px; padding: 9px 12px; border-radius: 8px; font-size: 12px; margin-bottom: 12px; }
  .alert.red { background: var(--red-soft); color: var(--red); border: 1px solid rgba(248,113,113,0.3); }
  .alert.amber { background: var(--amber-soft); color: var(--amber); border: 1px solid rgba(251,191,36,0.3); }
  .alert.amber > div { display: flex; flex-direction: column; gap: 2px; }
  .noleak { display: flex; align-items: center; gap: 8px; padding: 9px 12px; border-radius: 8px; background: var(--accent-soft); color: #b9cbff; font-size: 12px; margin-top: 14px; }
  .import-hint { display: flex; align-items: center; gap: 10px; margin-top: 10px; }
  .import-hint .link { background: none; border: none; padding: 0; }

  .progress-card { margin-bottom: 14px; }
  .setup { margin-top: 8px; }
  .setup-body { display: flex; gap: 20px; padding: 26px; align-items: flex-start; }
  .setup-icon {
    width: 52px; height: 52px; border-radius: 14px;
    display: grid; place-items: center;
    background: var(--accent-soft); color: var(--accent);
    flex-shrink: 0;
  }
  .setup-text { flex: 1; }
  .setup-text h3 { margin: 2px 0 6px; font-size: 15px; }
  .setup-controls { display: flex; gap: 14px; align-items: flex-end; margin-top: 16px; flex-wrap: wrap; }

  .dataset-strip { margin-top: 8px; }
  .ds-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 18px; }
  .ds-item { display: flex; flex-direction: column; gap: 3px; }
  .ds-value { font-family: var(--mono); font-size: 17px; font-weight: 600; }
  .ds-value.red { color: var(--red); }
  .ring-row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 14px; }
  .ring-pill {
    display: flex; align-items: center; gap: 7px;
    padding: 5px 10px; border-radius: 8px;
    border: 1px solid var(--border); background: rgba(148,163,184,0.04);
  }
  .ring-dot { width: 7px; height: 7px; border-radius: 2px; }
  .ready-hint {
    display: flex; align-items: center; gap: 8px;
    margin-top: 14px; padding: 9px 12px;
    border-radius: 8px; background: var(--accent-soft);
    color: #b9cbff; font-size: 12px;
  }

  .kpis {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(168px, 1fr));
    gap: 10px;
    margin: 14px 0;
  }
  .result-bar { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }

  .overview-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
  .stack-bar { display: flex; height: 22px; border-radius: 6px; overflow: hidden; background: #0a0f1a; }
  .stack-seg { height: 100%; transition: width 0.3s; }
  .legend { display: flex; gap: 14px; flex-wrap: wrap; margin-top: 10px; }
  .legend-item { display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: var(--text-dim); }
  .swatch { width: 8px; height: 8px; border-radius: 2px; display: inline-block; }
  .reason-list { display: flex; flex-direction: column; gap: 7px; }
  .reason { display: grid; grid-template-columns: minmax(0, 1fr) 90px 34px; gap: 8px; align-items: center; }
  .reason-label { font-size: 11.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .reason-bar { height: 5px; border-radius: 999px; background: rgba(148,163,184,0.12); overflow: hidden; }
  .reason-bar > span { display: block; height: 100%; background: var(--accent); border-radius: 999px; }
  .coverage .cov-row { display: flex; align-items: baseline; gap: 10px; }
  .coverage .mono { font-size: 16px; font-weight: 600; color: var(--violet); }

  .rules-table { display: flex; flex-direction: column; min-height: 0; }
  .table-tools { display: flex; align-items: center; gap: 10px; padding: 9px 12px; border-bottom: 1px solid var(--border); }
  .table-scroll { max-height: calc(100vh - 380px); overflow: auto; }
  .rule-cell { display: flex; align-items: center; gap: 7px; }
  .rule-name { font-weight: 550; }
  th.num, td.num { text-align: right; }
  td.bad { color: var(--red); }
  .mode-split { margin-top: 2px; white-space: nowrap; }
  .pct-cell { font-family: var(--mono); font-size: 11.5px; }
  .pct-cell.good { color: var(--green); }
  .pct-cell.mid { color: var(--amber); }
  .pct-cell.bad { color: var(--red); }

  .breakdown-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 10px; }
  .bd-card { padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }
  .bd-head { display: flex; align-items: center; justify-content: space-between; }
  .bd-bar { height: 8px; border-radius: 999px; overflow: hidden; background: rgba(248,113,113,0.3); }
  .bd-fraud { height: 100%; background: var(--green); border-radius: 999px; }
  .bd-meta { display: flex; align-items: center; gap: 7px; }

  .clickable { cursor: pointer; }
  .reasons-cell { max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .txn-fields { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px 14px; padding: 12px; background: var(--bg); border-radius: 9px; }
  .tf { display: flex; flex-direction: column; gap: 1px; }
  .tf-label { font-size: 10px; color: var(--text-faint); }
  .tf-value { font-size: 12px; }
  .hit-block { padding: 10px 12px; border-radius: 9px; background: var(--bg); border: 1px solid var(--border); }
  .reasons { margin: 8px 0 0; padding-left: 18px; font-size: 12px; line-height: 1.6; color: var(--text-dim); }
  .toggle-row { display: flex; align-items: center; gap: 6px; font-size: 12px; cursor: pointer; }
  .toggle-row input { accent-color: var(--accent); }
</style>
