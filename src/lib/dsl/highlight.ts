import { lex, type Token } from './lexer';
import { FIELD_MAP, FN_MAP } from './functions';

export interface HighlightToken {
  text: string;
  cls: string;
}

/** Tokenise DSL source into spans for the syntax-highlighted editor overlay. */
export function highlight(src: string, fallback = true): HighlightToken[] {
  const out: HighlightToken[] = [];
  try {
    const tokens = lex(src);
    let cursor = 0;
    for (const tok of tokens) {
      if (tok.type === 'eof') break;
      if (tok.pos.offset > cursor) {
        out.push({ text: src.slice(cursor, tok.pos.offset), cls: 'ws' });
      }
      out.push({ text: tok.raw, cls: classOf(tok) });
      cursor = tok.end;
    }
    if (cursor < src.length) out.push({ text: src.slice(cursor), cls: 'ws' });
    return out;
  } catch {
    if (!fallback) throw new Error('lex failed');
    // lexer can fail mid-string; keep whatever prefix tokenises then plain text
    return plain(src, 'ws');
  }
}

function classOf(tok: Token): string {
  switch (tok.type) {
    case 'number':
      return 'num';
    case 'duration':
      return 'dur';
    case 'string':
      return 'str';
    case 'ident': {
      if (['and', 'or', 'not', 'in', 'where', 'true', 'false', 'null'].includes(tok.value)) return 'kw';
      if (FN_MAP.has(tok.value)) return 'fn';
      if (FIELD_MAP.has(tok.value)) return 'fld';
      return 'ident';
    }
    case 'op':
      return 'op';
    default:
      return 'ws';
  }
}

function plain(src: string, cls: string): HighlightToken[] {
  return [{ text: src, cls }];
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
