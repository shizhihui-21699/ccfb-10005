import type { CExpr, EvalContext } from '../dsl/compiler';
import type { ExplainNode } from '../dsl/compiler';
export type { ExplainNode };

export interface EvalOptions {
  explain?: boolean;
}

export function evalExpr(expr: CExpr, ctx: EvalContext, explain: boolean): { value: unknown; node?: ExplainNode } {
  return evalNode(expr, ctx, explain);
}

function evalNode(expr: CExpr, ctx: EvalContext, explain: boolean): { value: unknown; node?: ExplainNode } {
  switch (expr.k) {
    case 'const':
      return { value: expr.value };
    case 'field': {
      const v = ctx.row[expr.name];
      return { value: v === undefined ? null : v };
    }
    case 'agg':
      return { value: ctx.agg(expr.id) };
    case 'array':
      return { value: expr.items.map((item) => evalNode(item, ctx, false).value) };
    case 'un': {
      const r = evalNode(expr.operand, ctx, explain);
      const value = expr.op === 'not' ? !truthy(r.value) : -toNum(r.value);
      return {
        value,
        node: explain
          ? {
              kind: 'not',
              label: expr.label,
              value,
              pass: !!value,
              decisive: false,
              children: r.node ? [r.node] : undefined,
            }
          : undefined,
      };
    }
    case 'bin': {
      const left = evalNode(expr.left, ctx, explain);
      const right = evalNode(expr.right, ctx, explain);
      const value = applyBinary(expr.op, left.value, right.value);
      let node: ExplainNode | undefined;
      if (explain) {
        const isLogical = expr.op === 'and' || expr.op === 'or';
        node = {
          kind: isLogical ? (expr.op as 'and' | 'or') : 'compare',
          label: expr.label,
          value,
          pass: !!value,
          decisive: false,
          op: expr.op,
          children: [left.node, right.node].filter(Boolean) as ExplainNode[],
        } as ExplainNode;
        markDecisive(node);
      }
      return { value, node };
    }
    case 'call': {
      const value = applyCall(expr.name, expr, ctx);
      const node: ExplainNode | undefined = explain
        ? {
            kind: 'leaf',
            label: expr.label,
            value,
            pass: !!value,
            decisive: false,
          }
        : undefined;
      return { value, node };
    }
  }
}

function markDecisive(node: ExplainNode): void {
  if (node.kind === 'and') {
    // In a failing AND, the failing child that made it fail is the decisive one;
    // if all pass, all are equally necessary.
    const children = node.children ?? [];
    if (!node.pass) {
      const failing = children.filter((c) => !c.pass);
      if (failing.length === 1) failing[0].decisive = true;
    }
  } else if (node.kind === 'or') {
    const children = node.children ?? [];
    if (node.pass) {
      const passing = children.filter((c) => c.pass);
      if (passing.length === 1) passing[0].decisive = true;
    }
  } else if (node.kind === 'not') {
    node.children?.forEach((c) => (c.decisive = true));
  } else if (node.kind === 'compare') {
    node.children?.forEach((c) => (c.decisive = true));
    node.decisive = !node.pass;
  }
}

function truthy(v: unknown): boolean {
  return v === true;
}

function toNum(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (!Number.isNaN(n)) return n;
  }
  return 0;
}

function toStr(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v);
}

function applyBinary(op: string, left: unknown, right: unknown): unknown {
  switch (op) {
    case 'and':
      return truthy(left) && truthy(right);
    case 'or':
      return truthy(left) || truthy(right);
    case '>':
      return compare(left, right) > 0;
    case '<':
      return compare(left, right) < 0;
    case '>=':
      return compare(left, right) >= 0;
    case '<=':
      return compare(left, right) <= 0;
    case '==':
      return looseEqual(left, right);
    case '!=':
      return !looseEqual(left, right);
    case 'in': {
      if (!Array.isArray(right)) return false;
      return right.some((item) => looseEqual(left, item));
    }
    case '+':
      if (typeof left === 'string' || typeof right === 'string') return toStr(left) + toStr(right);
      return toNum(left) + toNum(right);
    case '-':
      return toNum(left) - toNum(right);
    case '*':
      return toNum(left) * toNum(right);
    case '/': {
      const d = toNum(right);
      return d === 0 ? 0 : toNum(left) / d;
    }
    case '%': {
      const d = toNum(right);
      return d === 0 ? 0 : toNum(left) % d;
    }
    default:
      return false;
  }
}

function compare(a: unknown, b: unknown): number {
  if (typeof a === 'number' || typeof b === 'number') {
    const x = toNum(a);
    const y = toNum(b);
    return x < y ? -1 : x > y ? 1 : 0;
  }
  if (typeof a === 'boolean' || typeof b === 'boolean') {
    const x = a ? 1 : 0;
    const y = b ? 1 : 0;
    return x - y;
  }
  const x = toStr(a);
  const y = toStr(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

function looseEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || a === undefined) return b === null || b === undefined;
  if (typeof a === 'boolean' || typeof b === 'boolean') {
    return (a ? 1 : 0) === (b ? 1 : 0) && typeof a === typeof b;
  }
  if (typeof a === 'number' || typeof b === 'number') {
    if (typeof a === 'string' && a.trim() === '') return false;
    if (typeof b === 'string' && b.trim() === '') return false;
    return toNum(a) === toNum(b);
  }
  return toStr(a) === toStr(b);
}

function applyCall(name: string, expr: CExpr & { k: 'call' }, ctx: EvalContext): unknown {
  const args = expr.args.map((a) => evalNode(a, ctx, false).value);
  switch (name) {
    case 'in_list':
      return ctx.list(expr.listId ?? '', args[0]);
    case 'not_in_list':
      return !ctx.list(expr.listId ?? '', args[0]);
    case 'matches':
      return expr.regex ? expr.regex.test(toStr(args[0])) : false;
    case 'contains':
      return toStr(args[0]).includes(toStr(args[1]));
    case 'starts_with':
      return toStr(args[0]).startsWith(toStr(args[1]));
    case 'ends_with':
      return toStr(args[0]).endsWith(toStr(args[1]));
    case 'len':
      return Array.isArray(args[0]) ? args[0].length : toStr(args[0]).length;
    case 'lower':
      return toStr(args[0]).toLowerCase();
    case 'upper':
      return toStr(args[0]).toUpperCase();
    case 'abs':
      return Math.abs(toNum(args[0]));
    case 'round': {
      const digits = toNum(args[1] ?? 0);
      const f = 10 ** digits;
      return Math.round(toNum(args[0]) * f) / f;
    }
    case 'coalesce':
      for (const a of args) if (a !== null && a !== undefined) return a;
      return null;
    case 'hour_of':
      return new Date(toNum(args[0])).getUTCHours();
    case 'weekday_of':
      return new Date(toNum(args[0])).getUTCDay();
    default:
      return null;
  }
}

/** Flatten an explanation tree into a list of contributing leaves with pass state. */
export function collectLeaves(node: ExplainNode | undefined, out: ExplainNode[] = []): ExplainNode[] {
  if (!node) return out;
  if (node.kind === 'leaf' || node.kind === 'compare') {
    out.push(node);
    return out;
  }
  for (const child of node.children ?? []) collectLeaves(child, out);
  return out;
}

/** Short human summary of what actually triggered a hit. */
export function summarizeExplanation(node: ExplainNode | undefined, max = 4): string[] {
  if (!node) return [];
  const leaves = collectLeaves(node).filter((l) => l.pass);
  const decisive = leaves.filter((l) => l.decisive);
  const chosen = decisive.length > 0 ? decisive : leaves;
  return chosen.slice(0, max).map((l) => describeLeaf(l));
}

function describeLeaf(node: ExplainNode): string {
  if (node.kind === 'compare') {
    return `${node.label}（实际 ${formatValue(node.value)}）`;
  }
  return `${node.label}（${formatValue(node.value)}）`;
}

function formatValue(v: unknown): string {
  if (typeof v === 'boolean') return v ? '是' : '否';
  if (typeof v === 'number') {
    if (Number.isInteger(v)) return v.toLocaleString('en-US');
    return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }
  if (v === null || v === undefined) return '空';
  return String(v);
}
