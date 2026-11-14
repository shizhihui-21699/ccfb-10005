import type { RulePackage, RuleVersion, RuleList, Rule, RuleGroup } from '../types';
import { seedPackage } from '../data/seed-rules';
import { compileRule, type CompiledRule, type Diagnostic } from '../dsl/compiler';

function loadPackage(): RulePackage {
  if (typeof localStorage === 'undefined') return seedPackage();
  try {
    const raw = localStorage.getItem('sentinel.package');
    if (raw) {
      const parsed = JSON.parse(raw) as RulePackage;
      if (parsed && Array.isArray(parsed.rules) && Array.isArray(parsed.groups)) return parsed;
    }
  } catch {
    // fall through to seed
  }
  return seedPackage();
}

function loadVersions(): RuleVersion[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem('sentinel.versions');
    if (raw) return JSON.parse(raw) as RuleVersion[];
  } catch {
    // ignore
  }
  return [];
}

let nextVersionSeq = 1;
for (const v of loadVersions()) nextVersionSeq = Math.max(nextVersionSeq, v.seq + 1);

export const app = $state({
  package: loadPackage(),
  versions: loadVersions() as RuleVersion[],
  currentVersionId: null as string | null,
  dirty: false,
  /** Text shown in the DSL diagnostics pane; kept separate so typing is responsive. */
  activeRuleId: null as string | null,
  toasts: [] as Array<{ id: number; kind: 'info' | 'success' | 'warn' | 'error'; text: string }>,
  /** Rule draft handed from the rings page to the rules page. */
  draftRule: null as null | Partial<Rule> & { expression: string },
});

// Always start with a published baseline so history has something to compare to.
if (app.versions.length === 0) {
  const baseline: RuleVersion = {
    id: 'v_baseline',
    seq: nextVersionSeq++,
    name: '初始版本',
    note: '由种子规则生成的基线版本',
    author: '风险策略团队',
    created_at: Date.now(),
    package: JSON.parse(JSON.stringify(app.package)) as RulePackage,
    published: true,
  };
  app.versions.unshift(baseline);
  app.currentVersionId = baseline.id;
  try {
    localStorage.setItem('sentinel.versions', JSON.stringify(app.versions));
    localStorage.setItem('sentinel.currentVersion', baseline.id);
  } catch {
    // ignore
  }
}

let toastSeq = 1;

export function toast(kind: 'info' | 'success' | 'warn' | 'error', text: string, ms = 3500) {
  const id = toastSeq++;
  app.toasts.push({ id, kind, text });
  setTimeout(() => {
    app.toasts = app.toasts.filter((t) => t.id !== id);
  }, ms);
}

export function persist() {
  try {
    localStorage.setItem('sentinel.package', JSON.stringify(app.package));
  } catch {
    // storage may be unavailable
  }
}

export function markDirty() {
  app.dirty = true;
  persist();
}

export function findGroup(id: string): RuleGroup | undefined {
  return app.package.groups.find((g) => g.id === id);
}

export function findList(id: string): RuleList | undefined {
  return app.package.lists.find((l) => l.id === id);
}

export function compileAll(pkg: RulePackage = app.package): Map<string, CompiledRule> {
  const lists = new Map(pkg.lists.map((l) => [l.id, l]));
  const out = new Map<string, CompiledRule>();
  for (const rule of pkg.rules) out.set(rule.id, compileRule(rule, { lists }));
  return out;
}

export function allDiagnostics(pkg: RulePackage = app.package): Array<{ rule: Rule; diagnostics: Diagnostic[] }> {
  const compiled = compileAll(pkg);
  const out: Array<{ rule: Rule; diagnostics: Diagnostic[] }> = [];
  for (const rule of pkg.rules) {
    const c = compiled.get(rule.id);
    if (c && c.diagnostics.length) out.push({ rule, diagnostics: c.diagnostics });
  }
  return out;
}

export function versionSnapshot(name: string, note: string, rolledBackFrom?: string): RuleVersion {
  const version: RuleVersion = {
    id: `v_${Math.random().toString(36).slice(2, 10)}`,
    seq: nextVersionSeq++,
    name,
    note,
    author: '风险策略团队',
    created_at: Date.now(),
    rolled_back_from: rolledBackFrom,
    package: JSON.parse(JSON.stringify(app.package)) as RulePackage,
    published: true,
    base_version_id: app.currentVersionId ?? undefined,
  };
  app.versions.unshift(version);
  app.currentVersionId = version.id;
  app.dirty = false;
  try {
    localStorage.setItem('sentinel.versions', JSON.stringify(app.versions));
    localStorage.setItem('sentinel.currentVersion', version.id);
  } catch {
    // ignore
  }
  persist();
  return version;
}

export function restoreVersion(versionId: string): RuleVersion | undefined {
  const v = app.versions.find((x) => x.id === versionId);
  if (!v) return undefined;
  app.package = JSON.parse(JSON.stringify(v.package)) as RulePackage;
  persist();
  return versionSnapshot(`回滚自 v${v.seq}`, `回滚到「${v.name}」，恢复该版本的规则、名单与分组`, v.id);
}

export function diffCounts(versionPackage: RulePackage): { rules: number; lists: number; groups: number } {
  const diff = <T extends { id: string }>(a: T[], b: T[]) => {
    const mapB = new Map(b.map((x) => [x.id, x]));
    let changed = 0;
    for (const item of a) {
      const other = mapB.get(item.id);
      if (!other || JSON.stringify(item) !== JSON.stringify(other)) changed++;
    }
    for (const other of b) if (!a.some((x) => x.id === other.id)) changed++;
    return changed;
  };
  return {
    rules: diff(app.package.rules, versionPackage.rules),
    lists: diff(app.package.lists, versionPackage.lists),
    groups: diff(app.package.groups, versionPackage.groups),
  };
}
