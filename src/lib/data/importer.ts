import { ColumnBuilder, type Columns, type Dataset, type DatasetSummary } from './schema';

export interface ImportResult {
  dataset: Dataset;
  warnings: string[];
  skipped: number;
}

const FIELD_ALIASES: Record<string, string> = {
  transaction_id: 'id', txn_id: 'id', transactionid: 'id',
  amount_usd: 'amount_usd', usd_amount: 'amount_usd',
  card: 'card_hash', card_number: 'card_hash', pan: 'card_hash', card_id: 'card_hash',
  device: 'device_id', deviceid: 'device_id',
  customer: 'customer_id', user_id: 'customer_id', account_id: 'customer_id',
  email: 'email_hash', phone: 'phone_hash',
  merchant: 'merchant_id', mcc_code: 'mcc',
  timestamp: 'ts', time: 'ts', date: 'ts', datetime: 'ts', created_at: 'ts',
  ip_address: 'ip',
};

export const REQUIRED_COLUMNS = ['ts', 'amount_usd', 'card_hash', 'device_id', 'ip', 'customer_id'];

export interface ParsedCsv {
  header: string[];
  rows: string[][];
  delimiter: string;
}

/** Minimal RFC4180-ish CSV parser: quoted fields, escaped quotes, CRLF, BOM. */
export function parseCsv(text: string): ParsedCsv {
  let src = text.replace(/^﻿/, '');
  const delimiter = detectDelimiter(src);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === delimiter) { row.push(field); field = ''; continue; }
    if (ch === '\n') {
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
      continue;
    }
    if (ch === '\r') continue;
    field += ch;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.length > 1 || row[0] !== '') rows.push(row);
  }
  const header = (rows.shift() ?? []).map((h) => h.trim());
  return { header, rows, delimiter };
}

function detectDelimiter(text: string): string {
  const line = text.slice(0, Math.min(text.length, 4000)).split('\n')[0] ?? '';
  const counts: Array<[string, number]> = [[',', 0], [';', 0], ['\t', 0], ['|', 0]];
  for (const ch of line) for (const c of counts) if (ch === c[0]) c[1]++;
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ',';
}

function normalizeHeader(h: string): string {
  const key = h.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return FIELD_ALIASES[key] ?? key;
}

function parseTs(value: string): number {
  if (!value) return NaN;
  if (/^\d{10}$/.test(value)) return Number(value) * 1000;
  if (/^\d{13}$/.test(value)) return Number(value);
  const numeric = Number(value);
  if (!Number.isNaN(numeric) && numeric > 1e11) return numeric;
  const parsed = Date.parse(value);
  return parsed;
}

export function importCsv(text: string, label = '导入数据'): ImportResult {
  const parsed = parseCsv(text);
  const warnings: string[] = [];
  const header = parsed.header.map(normalizeHeader);
  const idx = new Map(header.map((h, i) => [h, i]));
  const missing = REQUIRED_COLUMNS.filter((c) => !idx.has(c) && !(c === 'amount_usd' && idx.has('amount')));
  if (missing.length) {
    throw new Error(`缺少必需列：${missing.join(', ')}。可用的列名：${header.join(', ')}`);
  }

  const n = parsed.rows.length;
  const b = new ColumnBuilder(n);
  let skipped = 0;
  let skippedBadTs = 0;
  let skippedBadCard = 0;
  const currencies = new Set<string>();
  const countryCounts = new Map<string, number>();

  const get = (r: string[], name: string): string => {
    const i = idx.get(name);
    return i === undefined ? '' : (r[i] ?? '').trim();
  };

  for (const r of parsed.rows) {
    const ts = parseTs(get(r, 'ts'));
    if (!Number.isFinite(ts) || ts <= 0) { skipped++; skippedBadTs++; continue; }
    const card = get(r, 'card_hash');
    if (!card) { skipped++; skippedBadCard++; continue; }
    b.beginRow();
    const amountUsdRaw = get(r, 'amount_usd') || get(r, 'amount');
    const amountUsd = Number(amountUsdRaw.replace(/[^0-9.\-]/g, ''));
    const amount = Number((get(r, 'amount') || amountUsdRaw).replace(/[^0-9.\-]/g, ''));
    const currency = (get(r, 'currency') || 'USD').toUpperCase();
    currencies.add(currency);
    const country = (get(r, 'country') || get(r, 'merchant_country') || 'US').toUpperCase();
    countryCounts.set(country, (countryCounts.get(country) ?? 0) + 1);
    const date = new Date(ts);

    b.setFloat('ts', ts);
    b.setFloat('amount', Number.isFinite(amount) ? amount : 0);
    b.setFloat('amount_usd', Number.isFinite(amountUsd) ? amountUsd : 0);
    b.setInt('hour', date.getUTCHours());
    b.setInt('weekday', date.getUTCDay());
    b.setInt('is_new_device', /^(1|true|yes)$/i.test(get(r, 'is_new_device')));
    b.setInt('is_3ds', /^(1|true|yes)$/i.test(get(r, 'is_3ds')));
    const tenure = Number(get(r, 'customer_tenure_days'));
    b.setFloat('customer_tenure_days', Number.isFinite(tenure) ? tenure : 0);
    const cardTenure = Number(get(r, 'card_tenure_days'));
    b.setFloat('card_tenure_days', Number.isFinite(cardTenure) ? cardTenure : 0);

    b.setCat('id', get(r, 'id') || `TXN-${b.n - 1}`);
    b.setCat('currency', currency);
    b.setCat('channel', get(r, 'channel') || 'ecom');
    b.setCat('entry_mode', get(r, 'entry_mode') || 'token');
    b.setCat('mcc', get(r, 'mcc') || '5999');
    b.setCat('merchant_id', get(r, 'merchant_id') || get(r, 'merchant_name') || 'UNKNOWN');
    b.setCat('merchant_name', get(r, 'merchant_name') || get(r, 'merchant_id') || '未知商户');
    b.setCat('merchant_country', (get(r, 'merchant_country') || country).toUpperCase());
    b.setCat('country', country);
    b.setCat('city', get(r, 'city') || '—');
    b.setCat('card_hash', card);
    b.setCat('card_bin', get(r, 'card_bin') || card.slice(0, 6));
    b.setCat('card_country', (get(r, 'card_country') || country).toUpperCase());
    b.setCat('device_id', get(r, 'device_id') || 'UNKNOWN');
    b.setCat('ip', get(r, 'ip') || '0.0.0.0');
    b.setCat('ip_country', (get(r, 'ip_country') || country).toUpperCase());
    b.setCat('customer_id', get(r, 'customer_id') || 'UNKNOWN');
    b.setCat('email_hash', get(r, 'email_hash') || '');
    b.setCat('phone_hash', get(r, 'phone_hash') || '');
    b.setCat('status', get(r, 'status') || 'approved');
  }

  if (skippedBadTs) warnings.push(`${skippedBadTs} 行时间戳无法解析，已跳过`);
  if (skippedBadCard) warnings.push(`${skippedBadCard} 行缺少卡哈希，已跳过`);
  if (currencies.size > 1) warnings.push(`检测到多种币种（${[...currencies].slice(0, 5).join(', ')}），金额按 amount_usd 列统计`);
  if (!idx.has('amount_usd')) warnings.push('未找到 amount_usd 列，已回退使用 amount 作为美元金额');

  const cols = b.finish();
  const summary = summarizeImported(cols, label);
  return { dataset: { summary, cols, truth: null }, warnings, skipped };
}

export function summarizeImported(cols: Columns, label: string): DatasetSummary {
  let total = 0;
  for (let i = 0; i < cols.n; i++) total += cols.floats.amount_usd[i];
  return {
    n: cols.n,
    label,
    source: 'upload',
    startedAt: cols.floats.ts[0] ?? 0,
    endedAt: cols.floats.ts[cols.n - 1] ?? 0,
    totalAmountUsd: Math.round(total),
    fraudulent: 0,
    ringCount: 0,
    rings: [],
    cards: cols.cats.card_hash.dict.length - 1,
    customers: cols.cats.customer_id.dict.length - 1,
    devices: cols.cats.device_id.dict.length - 1,
    ips: cols.cats.ip.dict.length - 1,
    merchants: cols.cats.merchant_id.dict.length - 1,
    countries: cols.cats.country.dict.length - 1,
    hasLabels: false,
    notes: '上传数据 · 无标签，回放不计算真实命中率',
  };
}

/** Build a CSV template so users can see the expected shape. */
export function csvTemplate(): string {
  return [
    'id,ts,amount,currency,amount_usd,card_hash,device_id,ip,customer_id,merchant_id,merchant_name,mcc,channel,country,city,card_country,ip_country,email_hash,phone_hash,is_3ds,is_new_device,status',
    'TXN-1,2026-03-01T10:00:00Z,120.50,USD,120.50,C4539X3F0001,D4A0001,10.0.0.1,CU9A01,M1000,FreshMart,5411,ecom,US,New York,US,US,user@example.com,PH12345,false,false,approved',
    'TXN-2,2026-03-01T10:02:00Z,1.20,USD,1.20,C4539X3F0001,D4A0001,10.0.0.1,CU9A01,M1001,LuckySpin,7995,ecom,US,New York,US,US,user@example.com,PH12345,false,true,declined',
  ].join('\n');
}
