export const CATEGORICAL_FIELDS = [
  'id',
  'currency',
  'channel',
  'entry_mode',
  'mcc',
  'merchant_id',
  'merchant_name',
  'merchant_country',
  'country',
  'city',
  'card_hash',
  'card_bin',
  'card_country',
  'device_id',
  'ip',
  'ip_country',
  'customer_id',
  'email_hash',
  'phone_hash',
  'status',
] as const;

export const FLOAT_FIELDS = [
  'ts',
  'amount',
  'amount_usd',
  'customer_tenure_days',
  'card_tenure_days',
] as const;

export const INT_FIELDS = ['hour', 'weekday', 'is_new_device', 'is_3ds'] as const;

export type CategoricalField = (typeof CATEGORICAL_FIELDS)[number];
export type FloatField = (typeof FLOAT_FIELDS)[number];
export type IntField = (typeof INT_FIELDS)[number];

export interface CategoricalColumn {
  codes: Uint32Array;
  dict: string[];
}

export interface Columns {
  n: number;
  floats: Record<FloatField, Float64Array>;
  ints: Record<IntField, Uint8Array>;
  cats: Record<CategoricalField, CategoricalColumn>;
}

export interface TruthColumns {
  fraud: Uint8Array; // 0 legit, 1 ring, 2 solo
  ring: Uint16Array; // 0 = none
  ringNames: string[];
}

export interface DatasetSummary {
  n: number;
  label: string;
  source: 'demo' | 'upload';
  startedAt: number;
  endedAt: number;
  totalAmountUsd: number;
  fraudulent: number;
  ringCount: number;
  rings: Array<{ id: number; name: string; txns: number; amountUsd: number; color?: string }>;
  cards: number;
  customers: number;
  devices: number;
  ips: number;
  merchants: number;
  countries: number;
  hasLabels: boolean;
  notes?: string;
  generatedInMs?: number;
}

export interface Dataset {
  summary: DatasetSummary;
  cols: Columns;
  truth: TruthColumns | null;
}

export class ColumnBuilder {
  private floatArrays: Record<string, Float64Array>;
  private intArrays: Record<string, Uint8Array>;
  private catCodes: Record<string, Uint32Array>;
  private catDicts: Record<string, string[]>;
  private catIndex: Record<string, Map<string, number>>;
  n: number;
  capacity: number;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.n = 0;
    this.floatArrays = {};
    this.intArrays = {};
    this.catCodes = {};
    this.catDicts = {};
    this.catIndex = {};
    for (const f of FLOAT_FIELDS) this.floatArrays[f] = new Float64Array(capacity);
    for (const f of INT_FIELDS) this.intArrays[f] = new Uint8Array(capacity);
    for (const f of CATEGORICAL_FIELDS) {
      this.catCodes[f] = new Uint32Array(capacity);
      this.catDicts[f] = [''];
      this.catIndex[f] = new Map([['', 0]]);
    }
  }

  /** Advance to the next row. Call once before writing each row's fields. */
  beginRow(): number {
    return this.n++;
  }

  setFloat(field: FloatField, value: number): void {
    this.floatArrays[field][this.n - 1] = value;
  }

  setInt(field: IntField, value: number | boolean): void {
    this.intArrays[field][this.n - 1] = typeof value === 'boolean' ? (value ? 1 : 0) : value & 0xff;
  }

  setCat(field: CategoricalField, value: string | null | undefined): void {
    const s = value ?? '';
    if (s === '') {
      this.catCodes[field][this.n - 1] = 0;
      return;
    }
    let code = this.catIndex[field].get(s);
    if (code === undefined) {
      code = this.catDicts[field].length;
      this.catDicts[field].push(s);
      this.catIndex[field].set(s, code);
    }
    this.catCodes[field][this.n - 1] = code;
  }

  finish(): Columns {
    const floats = {} as Record<FloatField, Float64Array>;
    const ints = {} as Record<IntField, Uint8Array>;
    const cats = {} as Record<CategoricalField, CategoricalColumn>;
    const n = this.n;
    for (const f of FLOAT_FIELDS) floats[f] = this.floatArrays[f].subarray(0, n);
    for (const f of INT_FIELDS) ints[f] = this.intArrays[f].subarray(0, n);
    for (const f of CATEGORICAL_FIELDS) {
      cats[f] = { codes: this.catCodes[f].subarray(0, n), dict: this.catDicts[f] };
    }
    return { n, floats, ints, cats };
  }
}

/** A reusable row object — mutated in place to avoid 200k allocations per replay. */
export type Row = Record<string, unknown>;

export function makeRow(): Row {
  return {
    id: '',
    ts: 0,
    amount: 0,
    amount_usd: 0,
    currency: '',
    channel: '',
    entry_mode: '',
    mcc: '',
    merchant_id: '',
    merchant_name: '',
    merchant_country: '',
    country: '',
    city: '',
    card_hash: '',
    card_bin: '',
    card_country: '',
    device_id: '',
    ip: '',
    ip_country: '',
    customer_id: '',
    email_hash: '',
    phone_hash: '',
    status: '',
    hour: 0,
    weekday: 0,
    is_new_device: false,
    is_3ds: false,
    customer_tenure_days: 0,
    card_tenure_days: 0,
  };
}

export function fillRow(cols: Columns, i: number, row: Row): Row {
  row.ts = cols.floats.ts[i];
  row.amount = cols.floats.amount[i];
  row.amount_usd = cols.floats.amount_usd[i];
  row.customer_tenure_days = cols.floats.customer_tenure_days[i];
  row.card_tenure_days = cols.floats.card_tenure_days[i];
  row.hour = cols.ints.hour[i];
  row.weekday = cols.ints.weekday[i];
  row.is_new_device = cols.ints.is_new_device[i] === 1;
  row.is_3ds = cols.ints.is_3ds[i] === 1;
  for (const f of CATEGORICAL_FIELDS) {
    const col = cols.cats[f];
    row[f] = col.dict[col.codes[i]] ?? '';
  }
  return row;
}

export function rowAt(cols: Columns, i: number): Row {
  return fillRow(cols, i, makeRow());
}
