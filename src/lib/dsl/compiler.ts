import type { ExprNode, CallNode } from './ast';
import { parseExpression } from './parser';
import { DslSyntaxError } from './lexer';
import { FIELD_MAP, FN_MAP, type FieldType } from './functions';
import type { Rule, RuleList } from '../types';

export type DiagnosticSeverity = 'error' | 'warning' | 'info';

export interface Diagnostic {
  severity: DiagnosticSeverity;
  message: string;
  hint?: string;
  offset?: number;
  end?: number;
  line?: number;
  column?: number;
}

export type Value = number | string | boolean | null;
export type ValueType = 'number' | 'string' | 'boolean' | 'array' | 'duration' | 'null' | 'any';

export type AggKind = 'count' | 'sum' | 'avg' | 'min' | 'max' | 'distinct';

export interface AggPlan {
  id: number;
  kind: AggKind;
  windowMs: number;
  keyFields: string[];
  measure?: ExprNode;
  measureType?: ValueType;
  filter?: ExprNode;
  filterExpr?: CExpr;
  /** Human-readable condition, e.g. "同卡 近 10 分钟交易笔数". */
  label: string;
  /** Signature used for de-duplication. */
  signature: string;
  source: string;
  windowLabel: string;
  keyLabel: string;
}

export type CExpr =
  | { k: 'const'; value: Value; type: ValueType; label: string }
  | { k: 'field'; name: string; type: ValueType; label: string }
  | { k: 'agg'; id: number; type: ValueType; label: string }
  | { k: 'array'; items: CExpr[]; type: 'array'; label: string }
  | { k: 'bin'; op: string; left: CExpr; right: CExpr; type: ValueType; label: string }
  | { k: 'un'; op: 'not' | 'neg'; operand: CExpr; type: ValueType; label: string }
  | {
      k: 'call';
      name: string;
      args: CExpr[];
      type: ValueType;
      label: string;
      regex?: RegExp;
      listId?: string;
    };

export interface CompiledRule {
  rule: Rule;
  ast: ExprNode | null;
  expr: CExpr | null;
  aggregates: AggPlan[];
  diagnostics: Diagnostic[];
  ok: boolean;
  fieldsUsed: string[];
  listsUsed: string[];
  conditionCount: number;
}

export interface EvalContext {
  row: Record<string, unknown>;
  agg(id: number): number;
  list(id: string, value: unknown): boolean;
  timestamp: number;
}

export interface ExplainNode {
  kind: 'and' | 'or' | 'not' | 'compare' | 'leaf';
  label: string;
  value: unknown;
  pass: boolean;
  decisive: boolean;
  op?: string;
  children?: ExplainNode[];
}

export interface CompileOptions {
  lists?: Map<string, RuleList>;
}

const WINDOW_LABELS: Array<[number, string]> = [
  [604800000, '周'],
  [86400000, '天'],
  [3600000, '小时'],
  [60000, '分钟'],
  [1000, '秒'],
  [1, '毫秒'],
];

export function formatWindow(ms: number): string {
  if (ms <= 0) return '0';
  if (ms % 604800000 === 0) return `${ms / 604800000} 周`;
  if (ms % 86400000 === 0) return `${ms / 86400000} 天`;
  if (ms % 3600000 === 0) return `${ms / 3600000} 小时`;
  if (ms % 60000 === 0) return `${ms / 60000} 分钟`;
  if (ms % 1000 === 0) return `${ms / 1000} 秒`;
  return `${ms} 毫秒`;
}

export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (Number.isInteger(n)) return n.toLocaleString('en-US');
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function fieldLabel(name: string): string {
  return FIELD_MAP.get(name)?.label ?? name;
}

function typeFromField(t: FieldType): ValueType {
  if (t === 'timestamp' || t === 'number') return 'number';
  return t;
}

function literalLabel(v: Value): string {
  if (v === null) return 'null';
  if (typeof v === 'boolean') return v ? '是' : '否';
  if (typeof v === 'number') return formatNumber(v);
  return `「${v}」`;
}

const OP_LABEL: Record<string, string> = {
  '>': '>',
  '<': '<',
  '>=': '≥',
  '<=': '≤',
  '==': '=',
  '!=': '≠',
  and: '且',
  or: '或',
  in: '属于',
  '+': '+',
  '-': '−',
  '*': '×',
  '/': '÷',
  '%': '取余',
};

interface CompileCtx {
  src: string;
  aggs: AggPlan[];
  aggIndex: Map<string, number>;
  diagnostics: Diagnostic[];
  lists: Map<string, RuleList>;
  fieldsUsed: Set<string>;
  listsUsed: Set<string>;
  conditionCount: number;
  inAggregate: boolean;
}

const AGG_ARITY: Record<AggKind, { measure: boolean; minKeys: number }> = {
  count: { measure: false, minKeys: 1 },
  sum: { measure: true, minKeys: 1 },
  avg: { measure: true, minKeys: 1 },
  min: { measure: true, minKeys: 1 },
  max: { measure: true, minKeys: 1 },
  distinct: { measure: true, minKeys: 1 },
};

export function compileRule(rule: Rule, options: CompileOptions = {}): CompiledRule {
  const ctx: CompileCtx = {
    src: rule.expression,
    aggs: [],
    aggIndex: new Map(),
    diagnostics: [],
    lists: options.lists ?? new Map(),
    fieldsUsed: new Set(),
    listsUsed: new Set(),
    conditionCount: 0,
    inAggregate: false,
  };

  let ast: ExprNode | null = null;
  try {
    ast = parseExpression(rule.expression).ast;
  } catch (e) {
    const err = e as DslSyntaxError;
    if (err && err.pos) {
      ctx.diagnostics.push({
        severity: 'error',
        message: err.message,
        offset: err.pos.offset,
        line: err.pos.line,
        column: err.pos.column,
      });
    } else {
      ctx.diagnostics.push({ severity: 'error', message: (e as Error).message });
    }
    return {
      rule,
      ast: null,
      expr: null,
      aggregates: [],
      diagnostics: ctx.diagnostics,
      ok: false,
      fieldsUsed: [],
      listsUsed: [],
      conditionCount: 0,
    };
  }

  let expr: CExpr | null = null;
  try {
    expr = compileNode(ast, ctx);
  } catch (e) {
    ctx.diagnostics.push({ severity: 'error', message: (e as Error).message });
  }

  if (expr && expr.type !== 'boolean') {
    ctx.diagnostics.push({
      severity: 'error',
      message: `规则最终结果必须是布尔值，当前是 ${typeLabel(expr.type)}`,
      hint: '例如写成 `amount_usd > 1000 and count(10m, card_hash) >= 5`',
      offset: ast.pos.offset,
    });
  }

  const hasError = ctx.diagnostics.some((d) => d.severity === 'error');
  if (rule.expression.trim().length === 0) {
    ctx.diagnostics.push({ severity: 'error', message: '规则表达式为空' });
  }

  return {
    rule,
    ast,
    expr: hasError ? null : expr,
    aggregates: ctx.aggs,
    diagnostics: ctx.diagnostics,
    ok: !hasError && !!expr,
    fieldsUsed: [...ctx.fieldsUsed],
    listsUsed: [...ctx.listsUsed],
    conditionCount: ctx.conditionCount,
  };
}

function typeLabel(t: ValueType): string {
  const map: Record<ValueType, string> = {
    number: '数字',
    string: '字符串',
    boolean: '布尔值',
    array: '数组',
    duration: '时间窗口',
    null: '空值',
    any: '任意',
  };
  return map[t];
}

function sourceOf(node: ExprNode, src: string): string {
  return src.slice(node.pos.offset, node.end).trim();
}

function nodeSource(node: ExprNode, ctx: CompileCtx): string {
  return sourceOf(node, ctx.src);
}

function diagAt(
  ctx: CompileCtx,
  severity: DiagnosticSeverity,
  message: string,
  node: ExprNode | CallNode,
  hint?: string,
) {
  ctx.diagnostics.push({
    severity,
    message,
    hint,
    offset: node.pos.offset,
    end: node.end,
    line: node.pos.line,
    column: node.pos.column,
  });
}

function compileNode(node: ExprNode, ctx: CompileCtx): CExpr {
  switch (node.kind) {
    case 'literal':
      return {
        k: 'const',
        value: node.value as Value,
        type: node.value === null ? 'null' : (typeof node.value as ValueType),
        label: literalLabel(node.value as Value),
      };
    case 'duration': {
      diagAt(ctx, 'error', '时间窗口只能用在 count/sum/avg/min/max/distinct 的参数里', node);
      return { k: 'const', value: node.ms, type: 'duration', label: formatWindow(node.ms) };
    }
    case 'field': {
      const spec = FIELD_MAP.get(node.name);
      if (!spec) {
        ctx.diagnostics.push({
          severity: 'error',
          message: `未知字段 "${node.name}"`,
          hint: suggestField(node.name),
          offset: node.pos.offset,
          end: node.end,
        });
        return { k: 'field', name: node.name, type: 'any', label: node.name };
      }
      ctx.fieldsUsed.add(node.name);
      if (node.name === 'ts') {
        // ts itself is allowed but comparisons to ms work numerically
      }
      return {
        k: 'field',
        name: node.name,
        type: typeFromField(spec.type),
        label: spec.label,
      };
    }
    case 'array': {
      const items = node.items.map((item) => compileNode(item, ctx));
      if (items.length === 0) {
        diagAt(ctx, 'error', '数组不能为空', node);
      }
      const types = new Set(items.map((i) => i.type));
      if (types.size > 1) {
        diagAt(ctx, 'warning', '数组元素类型不一致，比较结果可能不符合预期', node);
      }
      return {
        k: 'array',
        items,
        type: 'array',
        label: `[${items.map((i) => i.label).join(', ')}]`,
      };
    }
    case 'unary': {
      const operand = compileNode(node.operand, ctx);
      if (node.op === 'not') {
        if (operand.type !== 'boolean' && operand.type !== 'any') {
          diagAt(ctx, 'warning', 'not 作用于非布尔值', node);
        }
        return { k: 'un', op: 'not', operand, type: 'boolean', label: `非(${operand.label})` };
      }
      if (operand.type !== 'number' && operand.type !== 'any') {
        diagAt(ctx, 'error', `取负只能作用于数字，当前是 ${typeLabel(operand.type)}`, node);
      }
      return { k: 'un', op: 'neg', operand, type: 'number', label: `负 ${operand.label}` };
    }
    case 'binary':
      return compileBinary(node, ctx);
    case 'call':
      return compileCall(node, ctx);
  }
}

function compileBinary(node: ExprNode & { kind: 'binary' }, ctx: CompileCtx): CExpr {
  const left = compileNode(node.left, ctx);
  const right = compileNode(node.right, ctx);
  const op = node.op;

  if (op === 'and' || op === 'or') {
    if (left.type !== 'boolean' && left.type !== 'any') {
      diagAt(ctx, 'warning', `${OP_LABEL[op]} 左侧不是布尔值`, node.left);
    }
    if (right.type !== 'boolean' && right.type !== 'any') {
      diagAt(ctx, 'warning', `${OP_LABEL[op]} 右侧不是布尔值`, node.right);
    }
    ctx.conditionCount += 0;
    return {
      k: 'bin',
      op,
      left,
      right,
      type: 'boolean',
      label: `${left.label} ${OP_LABEL[op]} ${right.label}`,
    };
  }

  if (['>', '<', '>=', '<=', '==', '!='].includes(op)) {
    ctx.conditionCount += 1;
    checkComparison(ctx, node, left, right, op);
    return {
      k: 'bin',
      op,
      left,
      right,
      type: 'boolean',
      label: `${left.label} ${OP_LABEL[op]} ${right.label}`,
    };
  }

  if (op === 'in') {
    ctx.conditionCount += 1;
    if (right.type !== 'array' && right.type !== 'any') {
      diagAt(ctx, 'error', 'in 右侧必须是数组，例如 `country in ["US", "BR"]`', node.right);
    }
    return {
      k: 'bin',
      op,
      left,
      right,
      type: 'boolean',
      label: `${left.label} 属于 ${right.label}`,
    };
  }

  // arithmetic
  if (left.type !== 'number' && left.type !== 'any') {
    diagAt(ctx, 'error', `运算符 ${op} 需要数字，左侧是 ${typeLabel(left.type)}`, node.left);
  }
  if (right.type !== 'number' && right.type !== 'any') {
    diagAt(ctx, 'error', `运算符 ${op} 需要数字，右侧是 ${typeLabel(right.type)}`, node.right);
  }
  return {
    k: 'bin',
    op,
    left,
    right,
    type: 'number',
    label: `(${left.label} ${OP_LABEL[op]} ${right.label})`,
  };
}

function checkComparison(
  ctx: CompileCtx,
  node: ExprNode & { kind: 'binary' },
  left: CExpr,
  right: CExpr,
  op: string,
) {
  if (left.type === 'duration' || right.type === 'duration') {
    diagAt(ctx, 'error', '时间窗口不能直接参与比较，请写在聚合函数里', node);
    return;
  }
  const numeric = (t: ValueType) => t === 'number';
  const stringy = (t: ValueType) => t === 'string';
  if (
    (numeric(left.type) && (stringy(right.type) || right.type === 'boolean')) ||
    (numeric(right.type) && (stringy(left.type) || left.type === 'boolean'))
  ) {
    const lit = left.type === 'string' || left.type === 'boolean' ? left : right;
    if (lit.k === 'const') {
      const v = lit.value;
      if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) {
        diagAt(
          ctx,
          'warning',
          '数字与字符串字面量比较，建议改成数字，例如去掉引号',
          node,
        );
      } else if (typeof v === 'boolean') {
        diagAt(ctx, 'error', '数字与布尔值不能比较', node);
      } else {
        diagAt(ctx, 'error', '数字与字符串不能直接比较', node, '如果该字段是文本，请使用 matches/contains，或将比较值改成数字');
      }
    }
  }
  if (
    (left.type === 'boolean' && right.type !== 'boolean' && right.type !== 'null' && right.type !== 'any') ||
    (right.type === 'boolean' && left.type !== 'boolean' && left.type !== 'null' && left.type !== 'any')
  ) {
    diagAt(ctx, 'error', '布尔值只能与 true/false 比较', node);
  }
  if (op === 'in' && right.type !== 'array') {
    diagAt(ctx, 'error', 'in 右侧必须是数组', node.right);
  }
}

function compileCall(node: CallNode, ctx: CompileCtx): CExpr {
  const spec = FN_MAP.get(node.name);
  if (!spec) {
    ctx.diagnostics.push({
      severity: 'error',
      message: `未知函数 "${node.name}"`,
      hint: suggestFunction(node.name),
      offset: node.pos.offset,
      end: node.end,
    });
    return { k: 'const', value: null, type: 'any', label: node.name };
  }

  if (spec.category === 'aggregate') {
    return compileAggregate(node, ctx, spec.aggKind!);
  }

  const filter = (node as CallNode & { filter?: ExprNode }).filter;
  if (filter) {
    diagAt(ctx, 'error', 'where 过滤子句只支持聚合函数', node);
  }

  const args = node.args.map((arg) => compileNode(arg, ctx));
  const arity = arityOf(node.name);
  if (arity && (node.args.length < arity[0] || node.args.length > arity[1])) {
    diagAt(
      ctx,
      'error',
      `${node.name} 需要 ${arity[0] === arity[1] ? arity[0] : `${arity[0]}-${arity[1]}`} 个参数，实际 ${node.args.length} 个`,
      node,
    );
  }

  let type: ValueType = 'any';
  let label = '';
  let regex: RegExp | undefined;
  let listId: string | undefined;

  switch (node.name) {
    case 'in_list':
    case 'not_in_list': {
      type = 'boolean';
      const listArg = node.args[1];
      if (listArg?.kind !== 'literal' || typeof listArg.value !== 'string') {
        diagAt(ctx, 'error', `${node.name} 的第二个参数必须是名单 ID 字符串`, node);
      } else {
        listId = listArg.value;
        ctx.listsUsed.add(listId);
        const list = ctx.lists.get(listId);
        if (!list) {
          diagAt(
            ctx,
            'warning',
            `名单 "${listId}" 不存在`,
            node,
            '请先在「名单」页面创建，或检查 ID 拼写',
          );
          label = `列表「${listId}」`;
        } else {
          const fieldArg = node.args[0];
          if (fieldArg?.kind === 'field' && fieldArg.name !== 'card_hash') {
            // warn on mismatched entity type
            const specField = FIELD_MAP.get(fieldArg.name);
            const entityToField: Record<string, string> = {
              card: 'card_hash',
              device: 'device_id',
              ip: 'ip',
              customer: 'customer_id',
              email: 'email_hash',
              phone: 'phone_hash',
            };
            if (specField && entityToField[list.entity_type] !== fieldArg.name) {
              diagAt(
                ctx,
                'warning',
                `名单「${list.label}」的类型是 ${list.entity_type}，但这里传入的是 ${fieldArg.name}`,
                node,
                `建议使用 ${entityToField[list.entity_type] ?? '对应字段'}`,
              );
            }
          }
          label = `${args[0]?.label ?? ''} ${node.name === 'in_list' ? '命中' : '未命中'}名单「${list.label}」`;
        }
      }
      type = 'boolean';
      if (!label) label = `${args[0]?.label ?? ''} ${node.name === 'in_list' ? '命中' : '未命中'}名单`;
      break;
    }
    case 'matches': {
      type = 'boolean';
      const pattern = node.args[1];
      const patternValue =
        pattern?.kind === 'literal' && typeof pattern.value === 'string' ? pattern.value : null;
      if (patternValue === null) {
        diagAt(ctx, 'error', 'matches 的第二个参数必须是正则字符串', node);
      } else {
        try {
          regex = new RegExp(patternValue);
        } catch (e) {
          diagAt(ctx, 'error', `正则表达式无效：${(e as Error).message}`, node);
        }
      }
      label = `${args[0]?.label ?? ''} 匹配 /${patternValue ?? ''}/`;
      break;
    }
    case 'contains':
      type = 'boolean';
      label = `${args[0]?.label ?? ''} 包含 ${args[1]?.label ?? ''}`;
      break;
    case 'starts_with':
      type = 'boolean';
      label = `${args[0]?.label ?? ''} 以 ${args[1]?.label ?? ''} 开头`;
      break;
    case 'ends_with':
      type = 'boolean';
      label = `${args[0]?.label ?? ''} 以 ${args[1]?.label ?? ''} 结尾`;
      break;
    case 'len':
      type = 'number';
      label = `长度(${args[0]?.label ?? ''})`;
      break;
    case 'lower':
    case 'upper':
      type = 'string';
      label = `${node.name === 'lower' ? '小写' : '大写'}(${args[0]?.label ?? ''})`;
      break;
    case 'abs':
      type = 'number';
      label = `绝对值(${args[0]?.label ?? ''})`;
      break;
    case 'round':
      type = 'number';
      label = `四舍五入(${args[0]?.label ?? ''})`;
      break;
    case 'coalesce':
      type = args[0]?.type ?? 'any';
      label = `首个非空(${args.map((a) => a.label).join(', ')})`;
      break;
    case 'hour_of':
      type = 'number';
      label = `小时(${args[0]?.label ?? ''})`;
      break;
    case 'weekday_of':
      type = 'number';
      label = `星期(${args[0]?.label ?? ''})`;
      break;
    default:
      break;
  }

  ctx.conditionCount += type === 'boolean' ? 1 : 0;
  return { k: 'call', name: node.name, args, type, label, regex, listId };
}

const ARITY: Record<string, [number, number]> = {
  in_list: [2, 2],
  not_in_list: [2, 2],
  matches: [2, 2],
  contains: [2, 2],
  starts_with: [2, 2],
  ends_with: [2, 2],
  len: [1, 1],
  lower: [1, 1],
  upper: [1, 1],
  abs: [1, 1],
  round: [2, 2],
  coalesce: [1, 8],
  hour_of: [1, 1],
  weekday_of: [1, 1],
};

function arityOf(name: string): [number, number] | undefined {
  return ARITY[name];
}

function compileAggregate(node: CallNode, ctx: CompileCtx, kind: AggKind): CExpr {
  const meta = AGG_ARITY[kind];
  const filter = (node as CallNode & { filter?: ExprNode }).filter;

  if (ctx.inAggregate) {
    diagAt(ctx, 'error', '聚合函数不能嵌套', node);
    return { k: 'const', value: 0, type: 'number', label: node.name };
  }

  const expectedMin = meta.measure ? 3 : 2;
  if (node.args.length < expectedMin) {
    diagAt(
      ctx,
      'error',
      `${node.name} 至少需要 ${expectedMin} 个参数：${meta.measure ? '字段、时间窗口、分组字段' : '时间窗口、分组字段'}`,
      node,
      meta.measure
        ? `例如 ${node.name}(amount_usd, 10m, card_hash)`
        : '例如 count(10m, card_hash)',
    );
    return { k: 'const', value: 0, type: 'number', label: node.name };
  }

  let measureNode: ExprNode | undefined;
  let measureExpr: CExpr | undefined;
  let windowNode: ExprNode;
  let keyNodes: ExprNode[];

  if (meta.measure) {
    measureNode = node.args[0];
    windowNode = node.args[1];
    keyNodes = node.args.slice(2);
  } else {
    windowNode = node.args[0];
    keyNodes = node.args.slice(1);
  }

  let windowMs = -1;
  if (windowNode.kind !== 'duration') {
    diagAt(
      ctx,
      'error',
      '时间窗口必须是带单位的时间字面量，例如 10m、1h、7d',
      windowNode,
      '支持单位：ms、s、m、h、d、w',
    );
  } else {
    windowMs = windowNode.ms;
    if (windowMs <= 0) {
      diagAt(ctx, 'error', '时间窗口必须大于 0', windowNode);
    }
    if (windowMs > 90 * 86400000) {
      diagAt(ctx, 'warning', '窗口超过 90 天，回放会消耗大量内存', windowNode);
    }
  }

  ctx.inAggregate = true;
  if (measureNode) {
    if (measureNode.kind !== 'field') {
      diagAt(
        ctx,
        'error',
        `${kind} 的统计字段必须是单一字段名，例如 amount_usd`,
        measureNode,
        '如需条件统计，请使用 where 子句',
      );
    } else {
      measureExpr = compileNode(measureNode, ctx);
      if (kind !== 'distinct' && measureExpr.type !== 'number') {
        diagAt(
          ctx,
          'error',
          `${kind} 的统计字段必须是数字，当前是 ${typeLabel(measureExpr.type)}`,
          measureNode,
        );
      }
    }
  }

  const keyFields: string[] = [];
  for (const keyNode of keyNodes) {
    if (keyNode.kind !== 'field') {
      diagAt(
        ctx,
        'error',
        '分组字段必须是单一字段名，例如 card_hash、device_id、ip',
        keyNode,
      );
      continue;
    }
    const spec = FIELD_MAP.get(keyNode.name);
    if (!spec) {
      diagAt(ctx, 'error', `未知分组字段 "${keyNode.name}"`, keyNode, suggestField(keyNode.name));
      continue;
    }
    if (spec.type !== 'string' && spec.type !== 'number') {
      diagAt(ctx, 'warning', `字段 ${keyNode.name} 不是理想的关联键`, keyNode);
    }
    ctx.fieldsUsed.add(keyNode.name);
    keyFields.push(keyNode.name);
  }

  let filterExpr: CExpr | undefined;
  if (filter) {
    const aggsBefore = ctx.aggs.length;
    filterExpr = compileNode(filter, ctx);
    if (ctx.aggs.length !== aggsBefore) {
      diagAt(ctx, 'error', 'where 过滤条件里不能嵌套聚合函数', filter);
    }
    if (filterExpr.type !== 'boolean' && filterExpr.type !== 'any') {
      diagAt(ctx, 'error', 'where 过滤条件必须是布尔表达式', filter);
    }
  }
  ctx.inAggregate = false;

  if (keyFields.length === 0 || windowMs < 0) {
    return { k: 'const', value: 0, type: 'number', label: node.name };
  }

  const signature = JSON.stringify({
    kind,
    windowMs,
    keyFields,
    measure: measureNode ? nodeSource(measureNode, ctx) : null,
    filter: filter ? nodeSource(filter, ctx) : null,
  });
  let id = ctx.aggIndex.get(signature);
  if (id === undefined) {
    id = ctx.aggs.length;
    const keyLabel = keyFields
      .map((f) => FIELD_MAP.get(f)?.label ?? f)
      .join(' + ');
    const windowLabel = formatWindow(windowMs);
    let label: string;
    if (kind === 'count') {
      label = `${keyLabel} 近 ${windowLabel}交易笔数`;
    } else if (kind === 'distinct') {
      label = `${keyLabel} 近 ${windowLabel}的 ${measureExpr?.label ?? ''} 去重数`;
    } else if (kind === 'sum' && measureExpr?.label.includes('金额')) {
      label = `${keyLabel} 近 ${windowLabel}金额合计`;
    } else {
      const kindLabel =
        kind === 'sum' ? '合计' : kind === 'avg' ? '均值' : kind === 'min' ? '最小值' : '最大值';
      label = `${keyLabel} 近 ${windowLabel}的 ${measureExpr?.label ?? ''} ${kindLabel}`;
    }
    const whereLabel = filter ? `（仅统计 ${filterExpr?.label ?? '过滤后'} 的交易）` : '';
    ctx.aggs.push({
      id,
      kind,
      windowMs,
      keyFields,
      measure: measureNode,
      measureType: measureExpr?.type,
      filter,
      filterExpr,
      label: label + whereLabel,
      signature,
      source: nodeSource(node, ctx),
      windowLabel,
      keyLabel,
    });
    ctx.aggIndex.set(signature, id);
  }

  ctx.conditionCount += 1;
  const planLabel = ctx.aggs[id].label;
  return { k: 'agg', id, type: 'number', label: planLabel };
}

function suggestField(name: string): string | undefined {
  const candidates = [...FIELD_MAP.keys()];
  const best = closest(name, candidates);
  return best ? `你是不是想用 "${best}"？` : '可用的字段见左侧字段列表';
}

function suggestFunction(name: string): string | undefined {
  const best = closest(name, [...FN_MAP.keys()]);
  return best ? `你是不是想用 "${best}"？` : '可用的函数见左侧函数列表';
}

function closest(input: string, candidates: string[]): string | null {
  let best: string | null = null;
  let bestScore = Infinity;
  for (const c of candidates) {
    const d = levenshtein(input.toLowerCase(), c.toLowerCase());
    if (d < bestScore) {
      bestScore = d;
      best = c;
    }
  }
  const threshold = input.length <= 4 ? 1 : 2;
  return bestScore <= threshold ? best : null;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = new Array(n + 1);
  let cur = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}
