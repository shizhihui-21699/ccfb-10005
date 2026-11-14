import { describe, expect, it } from 'vitest';
import { importCsv, parseCsv } from '../src/lib/data/importer';

describe('CSV importer', () => {
  it('parses quoted fields with commas and escaped quotes', () => {
    const parsed = parseCsv('a,b\n"x,1","he said ""hi"""\n');
    expect(parsed.header).toEqual(['a', 'b']);
    expect(parsed.rows[0]).toEqual(['x,1', 'he said "hi"']);
  });

  it('detects semicolon and tab delimiters', () => {
    const semi = parseCsv('a;b\n1;2');
    expect(semi.rows[0]).toEqual(['1', '2']);
    const tab = parseCsv('a\tb\n1\t2');
    expect(tab.rows[0]).toEqual(['1', '2']);
  });

  it('imports with column aliases and normalises values', () => {
    const csv = [
      'timestamp,usd_amount,card_number,device,ip,user_id,country',
      '2026-03-01T10:00:00Z,120.5,4539...0001,D1,10.0.0.1,U1,us',
      '1772359200000,80,4539...0002,D2,10.0.0.2,U2,US',
    ].join('\n');
    const res = importCsv(csv, 'test');
    expect(res.dataset.summary.n).toBe(2);
    expect(res.dataset.cols.cats.card_hash.dict[res.dataset.cols.cats.card_hash.codes[0]]).toBe('4539...0001');
    expect(res.dataset.cols.floats.amount_usd[0]).toBe(120.5);
    expect(res.dataset.cols.cats.country.dict[res.dataset.cols.cats.country.codes[0]]).toBe('US');
  });

  it('skips rows with unparseable timestamps and reports them', () => {
    const csv = 'id,ts,amount_usd,card_hash,device_id,ip,customer_id\nA,not-a-date,10,C1,D1,1.1.1.1,U1\nB,2026-03-01T00:00:00Z,10,C2,D2,1.1.1.2,U2';
    const res = importCsv(csv);
    expect(res.dataset.summary.n).toBe(1);
    expect(res.skipped).toBe(1);
    expect(res.warnings.some((w) => w.includes('时间戳'))).toBe(true);
  });

  it('throws a helpful error when required columns are missing', () => {
    expect(() => importCsv('foo,bar\n1,2')).toThrow(/缺少必需列/);
  });
});
