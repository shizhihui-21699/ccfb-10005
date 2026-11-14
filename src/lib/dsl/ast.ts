export interface Pos {
  offset: number;
  line: number;
  column: number;
}

export type ExprNode =
  | LiteralNode
  | DurationNode
  | FieldNode
  | ArrayNode
  | CallNode
  | BinaryNode
  | UnaryNode;

export interface BaseNode {
  pos: Pos;
  end: number;
}

export interface LiteralNode extends BaseNode {
  kind: 'literal';
  value: string | number | boolean | null;
  raw: string;
}

export interface DurationNode extends BaseNode {
  kind: 'duration';
  ms: number;
  raw: string;
}

export interface FieldNode extends BaseNode {
  kind: 'field';
  name: string;
}

export interface ArrayNode extends BaseNode {
  kind: 'array';
  items: ExprNode[];
}

export interface CallNode extends BaseNode {
  kind: 'call';
  name: string;
  args: ExprNode[];
  /** Set by the compiler for aggregate calls. */
  aggId?: number;
  /** Set by the compiler for aggregate calls. */
  aggKind?: string;
}

export interface BinaryNode extends BaseNode {
  kind: 'binary';
  op: string;
  left: ExprNode;
  right: ExprNode;
}

export interface UnaryNode extends BaseNode {
  kind: 'unary';
  op: 'not' | 'neg';
  operand: ExprNode;
}
