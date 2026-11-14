<script lang="ts">
  import { analysisClient } from '../state/workers';
  import { dataset } from '../state/dataset.svelte';
  import type { RingAnalysis, DetectedRing } from '../engine/rings';
  import type { DatasetSummary } from '../data/schema';
  import Icon from '../components/Icon.svelte';
  import Modal from '../components/Modal.svelte';
  import Kpi from '../components/Kpi.svelte';
  import CanvasGraph from '../components/CanvasGraph.svelte';
  import { app, toast, markDirty } from '../state/store.svelte';
  import { nav } from '../state/nav.svelte';


  const summary = $derived(dataset.summary);
  let analysis = $state<RingAnalysis | null>(null);
  let busy = $state(false);
  let error = $state<string | null>(null);
  let status = $state('');
  let minMembers = $state(3);
  let maxIpFanout = $state(8);
  let maxShare = $state(5);
  let minScore = $state(0);
  let selected = $state<DetectedRing | null>(null);
  let memberLimit = $state(16);
  let showDetail = $state(false);
  let sortBy = $state<'risk' | 'txns' | 'fraudShare'>('risk');

  const client = analysisClient();

  async function generate() {
    busy = true;
    error = null;
    status = '正在生成交易数据…';
    try {
      await client.generate(dataset.size, dataset.seed, dataset.days);
      analysis = null;
      status = '';
    } catch (e) {
      error = (e as Error).message;
      status = '';
    } finally {
      busy = false;
    }
  }

  async function analyze() {
    if (!summary) { error = '请先生成数据'; return; }
    busy = true;
    error = null;
    status = '正在构建关联图并聚类…';
    try {
      analysis = await client.rings({ minMembers, maxIpFanout, maxShareOfRows: maxShare / 100 });
      status = '';
    } catch (e) {
      error = (e as Error).message;
      status = '';
    } finally {
      busy = false;
    }
  }

  const filtered = $derived(
    (analysis?.rings ?? [])
      .filter((r) => r.riskScore >= minScore)
      .sort((a, b) =>
        sortBy === 'risk' ? b.riskScore - a.riskScore
        : sortBy === 'txns' ? b.txns - a.txns
        : b.fraudShare - a.fraudShare,
      ),
  );

  const highRisk = $derived(filtered.filter((r) => r.riskScore >= 100 || r.fraudShare > 0.6));
  const totalFraudInRings = $derived(filtered.reduce((s, r) => s + r.fraudTxns, 0));
  const maxScore = $derived(Math.max(1, ...filtered.map((r) => r.riskScore)));

  const num = (v: number) => v.toLocaleString('en-US');
  const usd = (v: number) => '$' + v.toLocaleString('en-US');

  function draftRuleFromRing(ring: DetectedRing) {
    const devs = ring.links.filter((l) => l.type === 'device').slice(0, 3).map((l) => l.value);
    const ips = ring.links.filter((l) => l.type === 'ip').slice(0, 3).map((l) => l.value);
    const listId = `ring_${ring.id}_infra`;
    if (devs.length || ips.length) {
      const existing = app.package.lists.find((l) => l.id === listId);
      const entries = [...devs, ...ips];
      if (existing) existing.entries = entries;
      else {
        app.package.lists.push({
          id: listId,
          name: listId,
          label: `团伙 ${ring.id} 基础设施`,
          kind: 'watch',
          entity_type: devs.length ? 'device' : 'ip',
          entries,
          description: `由关联分析自动生成：风险分 ${ring.riskScore}，欺诈占比 ${(ring.fraudShare * 100).toFixed(0)}%`,
          updated_at: Date.now(),
        });
        markDirty();
      }
      const expression = devs.length
        ? `in_list(device_id, "${listId}")`
        : `in_list(ip, "${listId}")`;
      app.draftRule = { expression, name: `团伙 ${ring.id} 关联拦截`, mode: 'shadow', action: 'review', severity: 'high' };
    }
    showDetail = false;
    toast('success', '已生成规则草稿，切换到「规则编辑」即可微调');
    nav.page = 'rules';
  }

  function openRing(r: DetectedRing) {
    selected = r;
    memberLimit = 16;
    showDetail = true;
  }

  function spanDays(ms: number): string {
    if (ms < 3_600_000) return `${Math.round(ms / 60_000)} 分钟`;
    if (ms < 86_400_000) return `${(ms / 3_600_000).toFixed(1)} 小时`;
    return `${(ms / 86_400_000).toFixed(1)} 天`;
  }

  const linkIcon: Record<string, string> = { device: 'sliders', ip: 'network', card: 'list', phone: 'users', email: 'users', merchant: 'database' };
</script>

<div class="page">
  <div class="page-head">
    <div>
      <div class="row gap-8"><Icon name="network" size={16} /><h2>欺诈团伙分析</h2></div>
      <p class="muted sm">基于交易间的共享实体（卡、设备、IP、手机号）构建关联图，用并查集聚类并给可疑实体簇打分。适合发现规则难以覆盖的新型团伙。</p>
    </div>
  </div>

  {#if !summary}
    <div class="setup card">
      <div class="card-body setup-body">
        <div class="setup-icon"><Icon name="network" size={26} /></div>
        <div class="setup-text">
          <h3>先生成交易数据</h3>
          <p class="muted sm">演示数据内置了 5 个不同类型的欺诈团伙：卡测、跑分洗钱、盗刷卡、退款套现、合成身份。分析会尝试在不依赖标签的情况下把它们找出来。</p>
          <div class="setup-controls">
            <label class="col gap-4"><span class="tiny muted">规模</span>
              <select bind:value={dataset.size}>
                <option value={20000}>2 万笔</option>
                <option value={200000}>20 万笔（推荐）</option>
                <option value={500000}>50 万笔</option>
              </select>
            </label>
            <label class="col gap-4"><span class="tiny muted">种子</span><input type="number" bind:value={dataset.seed} style="width:130px" /></label>
            <label class="col gap-4"><span class="tiny muted">天数</span><input type="number" bind:value={dataset.days} style="width:90px" /></label>
            <button class="btn primary" onclick={generate} disabled={busy}><Icon name="sparkles" size={14} /> 生成并加载</button>
          </div>
        </div>
      </div>
    </div>
  {:else}
    <div class="dataset-strip card">
      <div class="card-body row" style="gap:18px;flex-wrap:wrap">
        <div class="ds-item"><span class="kpi-label">数据集</span><span class="ds-value">{num(summary.n)} 笔</span></div>
        <div class="ds-item"><span class="kpi-label">实体</span><span class="ds-value">{num(summary.customers)} 账户 · {num(summary.cards)} 卡 · {num(summary.devices)} 设备 · {num(summary.ips)} IP</span></div>
        <div class="ds-item"><span class="kpi-label">已知欺诈团伙</span><span class="ds-value red">{summary.ringCount} 个 · {num(summary.fraudulent)} 笔</span></div>
        <span class="spacer"></span>
        <button class="btn sm" onclick={generate} disabled={busy}><Icon name="database" size={12} /> 重新生成</button>
      </div>
    </div>

    <div class="controls card">
      <div class="card-body controls-body">
        <div class="param">
          <label class="kpi-label" for="p-min">最少成员</label>
          <input id="p-min" type="number" min="2" max="10" bind:value={minMembers} />
          <span class="tiny faint">簇内至少关联多少个实体</span>
        </div>
        <div class="param">
          <label class="kpi-label" for="p-ip">共享 IP 上限</label>
          <input id="p-ip" type="number" min="2" max="30" bind:value={maxIpFanout} />
          <span class="tiny faint">超过此数视为公共网络，不聚类</span>
        </div>
        <div class="param">
          <label class="kpi-label" for="p-share">最大占比</label>
          <div class="row gap-6">
            <input id="p-share" type="range" min="1" max="20" bind:value={maxShare} style="width:100px" />
            <span class="mono tiny">{maxShare}%</span>
          </div>
          <span class="tiny faint">超过数据量此比例的簇视为背景噪声</span>
        </div>
        <div class="param">
          <label class="kpi-label" for="p-score">最低风险分</label>
          <div class="row gap-6">
            <input id="p-score" type="range" min="0" max="300" step="10" bind:value={minScore} style="width:100px" />
            <span class="mono tiny">{minScore}</span>
          </div>
          <span class="tiny faint">仅显示高于该分的簇</span>
        </div>
        <span class="spacer"></span>
        <button class="btn primary" onclick={analyze} disabled={busy}>
          {#if busy}<span class="spinner"></span>{:else}<Icon name="zap" size={14} />{/if}
          {analysis ? '重新分析' : '开始关联分析'}
        </button>
      </div>
    </div>

    {#if status}<div class="status"><span class="spinner"></span> {status}</div>{/if}
    {#if error}<div class="alert red"><Icon name="alert" size={14} /> {error}</div>{/if}

    {#if analysis}
      <div class="kpis">
        <Kpi label="可疑簇" value={num(filtered.length)} tone="violet" icon="network" sub={`共 ${num(analysis.totalClusters)} 个连通分量`} />
        <Kpi label="高风险簇" value={num(highRisk.length)} tone={highRisk.length ? 'red' : 'green'} icon="alert" sub="风险分 ≥100 或欺诈占比 >60%" />
        <Kpi label="覆盖欺诈" value={num(totalFraudInRings)} tone="amber" icon="target" sub={`占已知欺诈的 ${summary.fraudulent ? ((totalFraudInRings / summary.fraudulent) * 100).toFixed(1) : '0'}%`} />
        <Kpi label="分析耗时" value={`${analysis.elapsedMs} ms`} icon="clock" sub={`${num(summary.n)} 笔交易`} />
      </div>

      <div class="list-head">
        <div class="tabbar">
          <button class={sortBy === 'risk' ? 'active' : ''} onclick={() => (sortBy = 'risk')}>按风险分</button>
          <button class={sortBy === 'txns' ? 'active' : ''} onclick={() => (sortBy = 'txns')}>按交易量</button>
          <button class={sortBy === 'fraudShare' ? 'active' : ''} onclick={() => (sortBy = 'fraudShare')}>按欺诈占比</button>
        </div>
        <span class="spacer"></span>
        <span class="tiny faint">点击卡片查看关联证据</span>
      </div>

      <div class="rings-grid">
        {#each filtered.slice(0, 30) as ring, i (ring.id)}
          <button class="ring-card {ring.fraudShare > 0.6 ? 'hot' : ring.riskScore > 60 ? 'warm' : ''}" onclick={() => openRing(ring)}>
            <div class="rc-head">
              <div class="row gap-8">
                <span class="rank mono">{String(i + 1).padStart(2, '0')}</span>
                <span class="rc-label">{ring.label}</span>
              </div>
              <span class="score mono">{ring.riskScore}</span>
            </div>
            <div class="score-bar"><span style="width:{(ring.riskScore / maxScore) * 100}%;background:{ring.fraudShare > 0.6 ? 'var(--red)' : ring.riskScore > 60 ? 'var(--amber)' : 'var(--accent)'}"></span></div>
            <div class="rc-stats">
              <div class="rc-stat"><span class="v mono">{num(ring.txns)}</span><span class="k">笔交易</span></div>
              <div class="rc-stat"><span class="v mono">{num(ring.size)}</span><span class="k">实体</span></div>
              <div class="rc-stat"><span class="v mono">{usd(ring.amountUsd)}</span><span class="k">金额</span></div>
              <div class="rc-stat"><span class="v mono">{spanDays(ring.timeSpanMs)}</span><span class="k">跨度</span></div>
            </div>
            {#if ring.fraudShare > 0}
              <div class="fraud-share">
                <span class="chip {ring.fraudShare > 0.6 ? 'red' : 'amber'} tiny">欺诈 {num(ring.fraudTxns)} 笔 · {(ring.fraudShare * 100).toFixed(0)}%</span>
                <div class="mini-bar"><span style="width:{ring.fraudShare * 100}%"></span></div>
              </div>
            {/if}
            <div class="rc-reasons">
              {#each ring.reasons.slice(0, 2) as reason}
                <span class="reason tag-sm">{reason}</span>
              {/each}
            </div>
            <div class="rc-links">
              {#each ring.links.slice(0, 3) as link}
                <span class="link-chip mono"><Icon name={linkIcon[link.type] ?? 'network'} size={10} />{link.value}</span>
              {/each}
              {#if ring.links.length > 3}<span class="tiny faint">+{ring.links.length - 3}</span>{/if}
            </div>
          </button>
        {/each}
      </div>
      {#if filtered.length === 0}
        <div class="empty card">没有达到条件的可疑簇，试试降低最低风险分</div>
      {/if}
    {/if}
  {/if}
</div>

<Modal open={showDetail} title={selected ? selected.label : ''} subtitle={selected ? `风险分 ${selected.riskScore} · ${num(selected.txns)} 笔 · ${usd(selected.amountUsd)}` : ''} width={720} onclose={() => (showDetail = false)}>
  {#if selected}
    <div class="col gap-14">
      <div class="row gap-8" style="flex-wrap:wrap">
        {#each selected.reasons as r}<span class="chip amber tiny">{r}</span>{/each}
      </div>

      <CanvasGraph ring={selected} width={660} height={250} />

      <div class="evidence-grid">
        <div class="ev-card">
          <div class="ev-label">实体构成</div>
          <div class="ev-values">
            <div><span class="mono">{selected.members.filter((m) => m.kind === 'customer').length}</span> 账户</div>
            <div><span class="mono">{selected.members.filter((m) => m.kind === 'card').length}</span> 卡</div>
            <div><span class="mono">{selected.members.filter((m) => m.kind === 'device').length}</span> 设备</div>
            <div><span class="mono">{selected.members.filter((m) => m.kind === 'ip').length}</span> IP</div>
          </div>
        </div>
        <div class="ev-card">
          <div class="ev-label">欺诈占比</div>
          <div class="ev-values">
            <div class="big-score {selected.fraudShare > 0.6 ? 'red' : 'amber'}">{(selected.fraudShare * 100).toFixed(0)}%</div>
            <div class="tiny muted">{num(selected.fraudTxns)} / {num(selected.txns)} 笔</div>
          </div>
        </div>
        <div class="ev-card">
          <div class="ev-label">时间跨度</div>
          <div class="ev-values">
            <div class="big-score">{spanDays(selected.timeSpanMs)}</div>
            <div class="tiny muted">{new Date(selected.firstTs).toISOString().slice(0, 10)} → {new Date(selected.lastTs).toISOString().slice(0, 10)}</div>
          </div>
        </div>
      </div>

      <div>
        <div class="kpi-label" style="margin-bottom:6px">关联证据（共享实体）</div>
        <div class="links-table">
          <div class="lt-head"><span>类型</span><span>值</span><span class="num">关联数</span></div>
          {#each selected.links as link}
            <div class="lt-row">
              <span class="lt-type"><Icon name={linkIcon[link.type] ?? 'network'} size={11} /> {link.type}</span>
              <span class="mono">{link.value}</span>
              <span class="num mono">{link.members}</span>
            </div>
          {/each}
        </div>
      </div>

      <div>
        <div class="kpi-label" style="margin-bottom:6px">簇内实体（按交易量）</div>
        <div class="members">
          {#each selected.members.slice(0, memberLimit) as m}
            <div class="member">
              <span class="m-kind {m.kind}">{m.kind === 'customer' ? '账户' : m.kind === 'card' ? '卡' : m.kind === 'device' ? '设备' : 'IP'}</span>
              <span class="mono m-id">{m.label}</span>
              <span class="spacer"></span>
              <span class="tiny faint mono">{num(m.txns)} 笔 · {usd(m.amountUsd)}</span>
            </div>
          {/each}
          {#if selected.members.length > memberLimit}
            <button class="btn ghost sm" onclick={() => (memberLimit += 30)}>显示更多（还有 {selected.members.length - memberLimit} 个）</button>
          {/if}
        </div>
      </div>

      <div class="actions-row">
        <button class="btn sm primary" onclick={() => draftRuleFromRing(selected!)}>
          <Icon name="rules" size={13} /> 用这条线索写规则
        </button>
      </div>
    </div>
  {/if}
</Modal>

<style>
  .page { height: 100%; overflow-y: auto; padding: 16px 20px 32px; }
  .page-head { margin-bottom: 14px; }
  h2 { margin: 0; font-size: 18px; font-weight: 650; }
  .page-head p { margin: 5px 0 0; max-width: 760px; }
  .setup-body { display: flex; gap: 20px; padding: 26px; align-items: flex-start; }
  .setup-icon { width: 52px; height: 52px; border-radius: 14px; display: grid; place-items: center; background: rgba(167,139,250,0.12); color: var(--violet); flex-shrink: 0; }
  .setup-text h3 { margin: 2px 0 6px; font-size: 15px; }
  .setup-controls { display: flex; gap: 14px; align-items: flex-end; margin-top: 16px; flex-wrap: wrap; }
  .dataset-strip { margin-bottom: 12px; }
  .ds-item { display: flex; flex-direction: column; gap: 2px; }
  .ds-value { font-family: var(--mono); font-size: 15px; font-weight: 600; }
  .ds-value.red { color: var(--red); }
  .controls { margin-bottom: 12px; }
  .controls-body { display: flex; gap: 18px; align-items: flex-end; flex-wrap: wrap; }
  .param { display: flex; flex-direction: column; gap: 4px; }
  .param input { width: 90px; padding: 5px 8px; }
  .status { display: flex; align-items: center; gap: 8px; padding: 8px 12px; color: var(--text-dim); font-size: 12px; }
  .alert { display: flex; align-items: center; gap: 8px; padding: 9px 12px; border-radius: 8px; font-size: 12px; margin-bottom: 12px; background: var(--red-soft); color: var(--red); border: 1px solid rgba(248,113,113,0.3); }
  .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; margin: 12px 0; }
  .list-head { display: flex; align-items: center; margin-bottom: 10px; }
  .rings-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(290px, 1fr)); gap: 10px; }
  .ring-card {
    display: flex; flex-direction: column; gap: 8px;
    text-align: left; padding: 12px 14px;
    background: var(--bg-elev); border: 1px solid var(--border);
    border-radius: var(--radius-lg); color: var(--text);
    transition: border-color 0.12s, transform 0.08s;
  }
  .ring-card:hover { border-color: var(--border-strong); transform: translateY(-1px); }
  .ring-card.hot { border-color: rgba(248,113,113,0.35); }
  .ring-card.warm { border-color: rgba(251,191,36,0.3); }
  .rc-head { display: flex; align-items: center; justify-content: space-between; }
  .rank { color: var(--text-faint); font-size: 11px; }
  .rc-label { font-size: 13px; font-weight: 600; }
  .score { font-size: 15px; font-weight: 700; color: var(--amber); }
  .score-bar { height: 4px; border-radius: 999px; background: rgba(148,163,184,0.12); overflow: hidden; }
  .score-bar > span { display: block; height: 100%; border-radius: 999px; }
  .rc-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
  .rc-stat { display: flex; flex-direction: column; }
  .rc-stat .v { font-size: 13px; font-weight: 600; }
  .rc-stat .k { font-size: 9.5px; color: var(--text-faint); }
  .fraud-share { display: flex; align-items: center; gap: 8px; }
  .mini-bar { flex: 1; height: 4px; border-radius: 999px; background: rgba(148,163,184,0.12); overflow: hidden; }
  .mini-bar > span { display: block; height: 100%; background: var(--red); border-radius: 999px; }
  .rc-reasons { display: flex; flex-direction: column; gap: 3px; }
  .reason { font-size: 10.5px; color: var(--text-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .rc-links { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
  .link-chip { display: inline-flex; align-items: center; gap: 4px; font-size: 9.5px; color: var(--text-faint); background: rgba(148,163,184,0.08); padding: 2px 6px; border-radius: 5px; max-width: 130px; overflow: hidden; text-overflow: ellipsis; }
  .gap-14 { gap: 14px; }
  .evidence-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .ev-card { background: var(--bg); border-radius: 9px; padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; }
  .ev-label { font-size: 10px; color: var(--text-faint); text-transform: uppercase; letter-spacing: 0.05em; }
  .ev-values { display: flex; flex-direction: column; gap: 2px; font-size: 12px; }
  .ev-values .mono { font-weight: 600; font-size: 15px; }
  .big-score { font-family: var(--mono); font-size: 22px; font-weight: 700; }
  .big-score.red { color: var(--red); }
  .big-score.amber { color: var(--amber); }
  .links-table { border: 1px solid var(--border); border-radius: 9px; overflow: hidden; }
  .lt-head { display: grid; grid-template-columns: 90px 1fr 80px; padding: 6px 10px; font-size: 10px; color: var(--text-faint); border-bottom: 1px solid var(--border); background: var(--bg-elev-2); }
  .lt-row { display: grid; grid-template-columns: 90px 1fr 80px; padding: 5px 10px; font-size: 11.5px; border-bottom: 1px solid rgba(30,41,63,0.4); }
  .lt-row:last-child { border-bottom: none; }
  .lt-type { display: flex; align-items: center; gap: 5px; color: var(--text-dim); }
  .num { text-align: right; }
  .members { display: flex; flex-direction: column; gap: 1px; max-height: 240px; overflow-y: auto; }
  .member { display: flex; align-items: center; gap: 8px; padding: 4px 8px; border-radius: 6px; font-size: 11.5px; }
  .member:hover { background: var(--bg-hover); }
  .m-kind { font-size: 9.5px; padding: 1px 6px; border-radius: 4px; background: rgba(148,163,184,0.12); color: var(--text-dim); }
  .m-kind.customer { background: rgba(91,140,255,0.14); color: #93c5fd; }
  .m-kind.card { background: rgba(167,139,250,0.14); color: var(--violet); }
  .m-kind.device { background: rgba(34,211,238,0.12); color: var(--cyan); }
  .m-kind.ip { background: rgba(251,191,36,0.12); color: var(--amber); }
  .m-id { color: var(--text-dim); }
  .actions-row { display: flex; justify-content: flex-end; border-top: 1px solid var(--border); padding-top: 12px; }
</style>
