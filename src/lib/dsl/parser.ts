import type { ExprNode, Pos, BinaryNode, UnaryNode, CallNode } from './ast';
import { DslSyntaxError, lex, type Token } from './lexer';

export interface ParseResult {
  ast: ExprNode;
  tokens: Token[];
}

const COMPARISON_OPS = new Set(['>', '<', '>=', '<=', '==', '!=']);

export class Parser {
  private tokens: Token[];
  private index = 0;
  private src: string;

  constructor(src: string) {
    this.src = src;
    this.tokens = lex(src);
  }

  parse(): ExprNode {
    if (this.peek().type === 'eof') {
      throw new DslSyntaxError('规则表达式为空', this.peek().pos);
    }
    const expr = this.parseOr();
    if (this.peek().type !== 'eof') {
      throw new DslSyntaxError(`意外的内容 "${this.peek().raw}"`, this.peek().pos);
    }
    return expr;
  }

  private peek(offset = 0): Token {
    return this.tokens[Math.min(this.index + offset, this.tokens.length - 1)];
  }

  private next(): Token {
    return this.tokens[this.index++];
  }

  private match(value: string): boolean {
    if (this.peek().value === value) {
      this.index++;
      return true;
    }
    return false;
  }

  private expect(value: string, message?: string): Token {
    const tok = this.peek();
    if (tok.value !== value) {
      throw new DslSyntaxError(message ?? `期望 "${value}"，实际是 ${describeToken(tok)}`, tok.pos);
    }
    this.index++;
    return tok;
  }

  private isKeyword(value: string): boolean {
    const t = this.peek();
    return t.type === 'ident' && t.value === value;
  }

  private parseOr(): ExprNode {
    let left = this.parseAnd();
    while (this.isKeyword('or') || this.peek().value === '||') {
      const opTok = this.next();
      const right = this.parseAnd();
      left = binary(opTok.value === '||' ? 'or' : 'or', left, right, opTok.pos, right.end);
    }
    return left;
  }

  private parseAnd(): ExprNode {
    let left = this.parseNot();
    while (this.isKeyword('and') || this.peek().value === '&&') {
      const opTok = this.next();
      const right = this.parseNot();
      left = binary('and', left, right, opTok.pos, right.end);
    }
    return left;
  }

  private parseNot(): ExprNode {
    if (this.isKeyword('not') || this.peek().value === '!') {
      const tok = this.next();
      const operand = this.parseNot();
      const node: UnaryNode = {
        kind: 'unary',
        op: 'not',
        operand,
        pos: tok.pos,
        end: operand.end,
      };
      return node;
    }
    return this.parseComparison();
  }

  private parseComparison(): ExprNode {
    const left = this.parseAdditive();
    const tok = this.peek();
    if (COMPARISON_OPS.has(tok.value)) {
      this.next();
      const right = this.parseAdditive();
      return binary(tok.value, left, right, tok.pos, right.end);
    }
    if (this.isKeyword('in')) {
      this.next();
      const right = this.parseAdditive();
      return binary('in', left, right, tok.pos, right.end);
    }
    return left;
  }

  private parseAdditive(): ExprNode {
    let left = this.parseMultiplicative();
    while (this.peek().value === '+' || this.peek().value === '-') {
      const tok = this.next();
      const right = this.parseMultiplicative();
      left = binary(tok.value, left, right, tok.pos, right.end);
    }
    return left;
  }

  private parseMultiplicative(): ExprNode {
    let left = this.parseUnary();
    while (this.peek().value === '*' || this.peek().value === '/' || this.peek().value === '%') {
      const tok = this.next();
      const right = this.parseUnary();
      left = binary(tok.value, left, right, tok.pos, right.end);
    }
    return left;
  }

  private parseUnary(): ExprNode {
    if (this.peek().value === '-') {
      const tok = this.next();
      const operand = this.parseUnary();
      return {
        kind: 'unary',
        op: 'neg',
        operand,
        pos: tok.pos,
        end: operand.end,
      };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): ExprNode {
    const tok = this.peek();

    if (tok.type === 'number') {
      this.next();
      return { kind: 'literal', value: Number(tok.value), raw: tok.raw, pos: tok.pos, end: tok.end };
    }
    if (tok.type === 'string') {
      this.next();
      return { kind: 'literal', value: tok.value, raw: tok.raw, pos: tok.pos, end: tok.end };
    }
    if (tok.type === 'duration') {
      this.next();
      return { kind: 'duration', ms: tok.durationMs ?? 0, raw: tok.raw, pos: tok.pos, end: tok.end };
    }
    if (tok.value === '(') {
      this.next();
      const expr = this.parseOr();
      this.expect(')', '括号未闭合');
      return expr;
    }
    if (tok.value === '[') {
      const start = tok.pos;
      this.next();
      const items: ExprNode[] = [];
      if (this.peek().value !== ']') {
        do {
          items.push(this.parseOr());
        } while (this.match(','));
      }
      const close = this.expect(']', '数组未闭合');
      return { kind: 'array', items, pos: start, end: close.end };
    }
    if (tok.type === 'ident') {
      // booleans & null
      if (tok.value === 'true' || tok.value === 'false') {
        this.next();
        return {
          kind: 'literal',
          value: tok.value === 'true',
          raw: tok.raw,
          pos: tok.pos,
          end: tok.end,
        };
      }
      if (tok.value === 'null') {
        this.next();
        return { kind: 'literal', value: null, raw: tok.raw, pos: tok.pos, end: tok.end };
      }
      this.next();
      if (this.peek().value === '(') {
        return this.parseCall(tok);
      }
      // dotted field path
      let name = tok.value;
      while (this.peek().value === '.') {
        this.next();
        const part = this.peek();
        if (part.type !== 'ident') {
          throw new DslSyntaxError('字段路径中期望标识符', part.pos);
        }
        this.next();
        name += '.' + part.value;
      }
      return { kind: 'field', name, pos: tok.pos, end: this.tokens[this.index - 1].end };
    }

    throw new DslSyntaxError(`期望表达式，实际是 ${describeToken(tok)}`, tok.pos);
  }

  private parseCall(nameTok: Token): CallNode {
    this.expect('(');
    const args: ExprNode[] = [];
    let whereExpr: ExprNode | null = null;
    let first = true;
    while (this.peek().value !== ')') {
      if (this.isKeyword('where')) {
        this.next();
        whereExpr = this.parseOr();
        break;
      }
      if (!first) this.expect(',', '参数之间需要用逗号分隔');
      args.push(this.parseOr());
      first = false;
    }
    const close = this.expect(')', `函数 ${nameTok.value} 的括号未闭合`);
    const call: CallNode = {
      kind: 'call',
      name: nameTok.value,
      args,
      pos: nameTok.pos,
      end: close.end,
    };
    if (whereExpr) {
      (call as CallNode & { filter?: ExprNode }).filter = whereExpr;
    }
    return call;
  }
}

function binary(
  op: string,
  left: ExprNode,
  right: ExprNode,
  pos: Pos,
  end: number,
): BinaryNode {
  return { kind: 'binary', op, left, right, pos, end };
}

function describeToken(tok: Token): string {
  if (tok.type === 'eof') return '表达式结尾';
  return `"${tok.raw}"`;
}

export function parseExpression(src: string): ParseResult {
  const parser = new Parser(src);
  const ast = parser.parse();
  return { ast, tokens: lex(src) };
}
