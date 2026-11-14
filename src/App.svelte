<script lang="ts">
  import Icon from './lib/components/Icon.svelte';
  import Toasts from './lib/components/Toasts.svelte';
  import RulesPage from './lib/pages/RulesPage.svelte';
  import ReplayPage from './lib/pages/ReplayPage.svelte';
  import ListsPage from './lib/pages/ListsPage.svelte';
  import VersionsPage from './lib/pages/VersionsPage.svelte';
  import RingsPage from './lib/pages/RingsPage.svelte';
  import { app } from './lib/state/store.svelte';
  import { allDiagnostics } from './lib/state/store.svelte';

  import { nav, type Page } from './lib/state/nav.svelte';
  let page = $derived(nav.page);

  const NAV: Array<{ id: Page; label: string; icon: string; hint: string }> = [
    { id: 'rules', label: '规则编辑', icon: 'rules', hint: '分组 · 优先级 · DSL' },
    { id: 'replay', label: '回放验证', icon: 'play', hint: '历史交易 · 命中率' },
    { id: 'rings', label: '团伙分析', icon: 'network', hint: '关联网络 · 实体簇' },
    { id: 'lists', label: '名单管理', icon: 'list', hint: '黑 / 白 / 观察' },
    { id: 'versions', label: '版本历史', icon: 'history', hint: '发布 · 对比 · 回滚' },
  ];

  let diagCount = $derived.by(() => {
    let errors = 0;
    for (const { diagnostics } of allDiagnostics()) {
      if (diagnostics.some((d) => d.severity === 'error')) errors++;
    }
    return errors;
  });

  let versionLabel = $derived.by(() => {
    const cur = app.versions.find((v) => v.id === app.currentVersionId);
    return cur ? `v${cur.seq}` : '未发布';
  });
</script>

<div class="shell">
  <header class="topbar">
    <div class="brand">
      <div class="logo"><Icon name="shield" size={18} /></div>
      <div>
        <div class="brand-name">Sentinel</div>
        <div class="brand-sub">支付风控规则控制台</div>
      </div>
    </div>
    <div class="divider-v"></div>
    <div class="env">
      <span class="dot-live"></span>
      <span class="tiny muted">生产镜像</span>
      <span class="chip gray tiny mono">{versionLabel}</span>
      {#if app.dirty}
        <span class="chip amber tiny">有未发布改动</span>
      {/if}
    </div>
    <div class="spacer"></div>
    <div class="stats">
      <div class="stat">
        <span class="stat-num">{app.package.rules.length}</span>
        <span class="stat-label">规则</span>
      </div>
      <div class="stat">
        <span class="stat-num">{app.package.groups.filter((g) => g.enabled).length}</span>
        <span class="stat-label">启用分组</span>
      </div>
      <div class="stat">
        <span class="stat-num {diagCount > 0 ? 'warn' : ''}">{app.package.rules.length - diagCount}/{app.package.rules.length}</span>
        <span class="stat-label">语法通过</span>
      </div>
    </div>
    {#if diagCount > 0}
      <button class="btn sm danger" onclick={() => (nav.page = 'rules')}>
        <Icon name="alert" size={13} /> {diagCount} 条规则有语法错误
      </button>
    {/if}
  </header>

  <nav class="rail">
    {#each NAV as item}
      <button class="nav-item {page === item.id ? 'active' : ''}" onclick={() => (nav.page = item.id)}>
        <Icon name={item.icon} size={18} />
        <span class="nav-label">{item.label}</span>
        <span class="nav-hint">{item.hint}</span>
      </button>
    {/each}
    <div class="spacer"></div>
    <div class="rail-footer">
      <div class="tiny faint">所有数据在浏览器本地处理</div>
      <div class="tiny faint">Web Worker · 无服务端依赖</div>
    </div>
  </nav>

  <main class="main">
    {#if page === 'rules'}
      <RulesPage />
    {:else if page === 'replay'}
      <ReplayPage />
    {:else if page === 'rings'}
      <RingsPage />
    {:else if page === 'lists'}
      <ListsPage />
    {:else if page === 'versions'}
      <VersionsPage />
    {/if}
  </main>
</div>

<Toasts />

<style>
  .shell {
    display: grid;
    grid-template-columns: 196px 1fr;
    grid-template-rows: 54px 1fr;
    height: 100vh;
    min-height: 0;
  }
  .topbar {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 0 16px;
    border-bottom: 1px solid var(--border);
    background: linear-gradient(180deg, #0d1322, #0a0f1b);
  }
  .brand { display: flex; align-items: center; gap: 10px; }
  .logo {
    width: 30px; height: 30px;
    display: grid; place-items: center;
    border-radius: 9px;
    background: linear-gradient(135deg, #5b8cff, #7c5cff);
    color: white;
    box-shadow: 0 4px 16px rgba(91, 140, 255, 0.35);
  }
  .brand-name { font-size: 14px; font-weight: 700; letter-spacing: 0.02em; line-height: 1.1; }
  .brand-sub { font-size: 10.5px; color: var(--text-dim); }
  .divider-v { width: 1px; height: 28px; background: var(--border); }
  .env { display: flex; align-items: center; gap: 8px; }
  .dot-live {
    width: 7px; height: 7px; border-radius: 50%;
    background: var(--green);
    box-shadow: 0 0 0 3px rgba(52, 211, 153, 0.15);
    animation: breathe 2.4s ease infinite;
  }
  @keyframes breathe { 50% { opacity: 0.5; } }
  .stats { display: flex; gap: 18px; align-items: center; }
  .stat { display: flex; align-items: baseline; gap: 5px; }
  .stat-num { font-family: var(--mono); font-size: 15px; font-weight: 600; }
  .stat-num.warn { color: var(--amber); }
  .stat-label { font-size: 10px; color: var(--text-faint); }

  .rail {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 10px 8px;
    border-right: 1px solid var(--border);
    background: #090d17;
    min-height: 0;
  }
  .nav-item {
    display: grid;
    grid-template-columns: 24px 1fr;
    grid-template-rows: auto auto;
    align-items: center;
    gap: 0 8px;
    padding: 9px 10px;
    border: 1px solid transparent;
    border-radius: 9px;
    background: transparent;
    color: var(--text-dim);
    text-align: left;
  }
  .nav-item:hover { background: var(--bg-hover); color: var(--text); }
  .nav-item.active {
    background: linear-gradient(135deg, rgba(91,140,255,0.14), rgba(124,92,255,0.08));
    border-color: rgba(91, 140, 255, 0.28);
    color: var(--text);
  }
  .nav-item.active :global(svg) { color: var(--accent); }
  .nav-item :global(svg) { grid-row: 1 / span 2; }
  .nav-label { font-size: 12.5px; font-weight: 600; }
  .nav-hint { font-size: 10px; color: var(--text-faint); }
  .nav-item.active .nav-hint { color: var(--text-dim); }
  .rail-footer {
    padding: 10px 8px;
    border-top: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .main {
    min-height: 0;
    overflow: hidden;
    background:
      radial-gradient(1200px 400px at 70% -10%, rgba(91, 140, 255, 0.06), transparent 70%),
      var(--bg);
  }
</style>
