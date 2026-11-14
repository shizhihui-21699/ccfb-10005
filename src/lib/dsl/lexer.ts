import type { Pos } from './ast';

export type TokenType = 'number' | 'string' | 'duration' | 'ident' | 'op' | 'eof';

export interface Token {
  type: TokenType;
  value: string;
  raw: string;
  pos: Pos;
  end: number;
  durationMs?: number;
}

export class DslSyntaxError extends Error {
  pos: Pos;
  constructor(message: string, pos: Pos) {
    super(message);
    this.name = 'DslSyntaxError';
    this.pos = pos;
  }
}

const DURATION_UNITS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};

const TWO_CHAR_OPS = new Set(['==', '!=', '>=', '<=', '&&', '||']);
const ONE_CHAR_OPS = new Set(['>', '<', '+', '-', '*', '/', '%', '!']);

export function lex(src: string): Token[] {
  const tokens: Token[] = [];
  let offset = 0;
  let line = 1;
  let column = 1;

  const pos = (): Pos => ({ offset, line, column });

  const advance = (count: number) => {
    for (let i = 0; i < count; i++) {
      const ch = src[offset];
      if (ch === '\n') {
        line++;
        column = 1;
      } else {
        column++;
      }
      offset++;
    }
  };

  const isIdentStart = (ch: string) => /[A-Za-z_]/.test(ch);
  const isIdentPart = (ch: string) => /[A-Za-z0-9_]/.test(ch);
  const isDigit = (ch: string) => ch >= '0' && ch <= '9';

  while (offset < src.length) {
    const ch = src[offset];

    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
      advance(1);
      continue;
    }

    // comments
    if (ch === '/' && src[offset + 1] === '/') {
      while (offset < src.length && src[offset] !== '\n') advance(1);
      continue;
    }
    if (ch === '/' && src[offset + 1] === '*') {
      const start = pos();
      advance(2);
      let closed = false;
      while (offset < src.length) {
        if (src[offset] === '*' && src[offset + 1] === '/') {
          advance(2);
          closed = true;
          break;
        }
        advance(1);
      }
      if (!closed) throw new DslSyntaxError('块注释未闭合', start);
      continue;
    }

    const start = pos();
    const startOffset = offset;

    // strings
    if (ch === '"' || ch === "'") {
      const quote = ch;
      advance(1);
      let value = '';
      let closed = false;
      while (offset < src.length) {
        const c = src[offset];
        if (c === '\\') {
          const next = src[offset + 1];
          if (next === 'n') value += '\n';
          else if (next === 't') value += '\t';
          else if (next === 'r') value += '\r';
          else if (next === '\\') value += '\\';
          else if (next === '"') value += '"';
          else if (next === "'") value += "'";
          else value += next ?? '';
          advance(2);
          continue;
        }
        if (c === quote) {
          advance(1);
          closed = true;
          break;
        }
        if (c === '\n') {
          throw new DslSyntaxError('字符串不能跨行，请使用 \\n 转义', { offset, line, column });
        }
        value += c;
        advance(1);
      }
      if (!closed) throw new DslSyntaxError('字符串未闭合', start);
      tokens.push({
        type: 'string',
        value,
        raw: src.slice(startOffset, offset),
        pos: start,
        end: offset,
      });
      continue;
    }

    // numbers & durations
    if (isDigit(ch)) {
      let raw = '';
      let hasDot = false;
      while (offset < src.length) {
        const c = src[offset];
        if (isDigit(c)) {
          raw += c;
          advance(1);
        } else if (c === '_') {
          advance(1);
        } else if (c === '.' && !hasDot && isDigit(src[offset + 1] ?? '')) {
          hasDot = true;
          raw += c;
          advance(1);
        } else {
          break;
        }
      }
      // duration suffix (ms, s, m, h, d, w) with a word boundary
      const rest = src.slice(offset, offset + 2);
      let unit = '';
      if (rest === 'ms') unit = 'ms';
      else if (/^[smhdw]/.test(rest) && !isIdentPart(src[offset + 2] ?? '')) unit = rest[0];
      if (unit) {
        const after = offset + unit.length;
        if (!isIdentPart(src[after] ?? '')) {
          advance(unit.length);
          const numeric = Number(raw.replace(/_/g, ''));
          tokens.push({
            type: 'duration',
            value: `${numeric}${unit}`,
            raw: src.slice(startOffset, offset),
            pos: start,
            end: offset,
            durationMs: numeric * DURATION_UNITS[unit],
          });
          continue;
        }
      }
      tokens.push({
        type: 'number',
        value: raw.replace(/_/g, ''),
        raw: src.slice(startOffset, offset),
        pos: start,
        end: offset,
      });
      continue;
    }

    // identifiers
    if (isIdentStart(ch)) {
      while (offset < src.length && isIdentPart(src[offset])) advance(1);
      const raw = src.slice(startOffset, offset);
      tokens.push({ type: 'ident', value: raw, raw, pos: start, end: offset });
      continue;
    }

    const two = src.slice(offset, offset + 2);
    if (TWO_CHAR_OPS.has(two)) {
      advance(2);
      tokens.push({ type: 'op', value: two, raw: two, pos: start, end: offset });
      continue;
    }

    if (ONE_CHAR_OPS.has(ch)) {
      advance(1);
      tokens.push({ type: 'op', value: ch, raw: ch, pos: start, end: offset });
      continue;
    }

    if ('()[],.'.includes(ch)) {
      advance(1);
      tokens.push({ type: 'op', value: ch, raw: ch, pos: start, end: offset });
      continue;
    }

    throw new DslSyntaxError(`无法识别的字符 "${ch}"`, start);
  }

  tokens.push({ type: 'eof', value: '', raw: '', pos: pos(), end: offset });
  return tokens;
}
