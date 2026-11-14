import { Rng, WeightedPicker } from './rng';
import { ColumnBuilder, type Columns, type Dataset, type DatasetSummary, type TruthColumns } from './schema';

export const BASE_TS = Date.UTC(2026, 2, 1, 0, 0, 0);
const DAY_MS = 86_400_000;

const CH_ECOM = 0;
const CH_POS = 1;
const CH_MOBILE = 2;
const CH_RECURRING = 3;
const CHANNELS = ['ecom', 'pos', 'mobile', 'recurring', 'atm'] as const;
const ENTRY_MODES = ['chip', 'contactless', 'swipe', 'manual', 'token'] as const;
const STATUSES = ['approved', 'declined', 'pending'] as const;

const EMAIL_DOMAINS = [
  'gmail.com', 'outlook.com', 'yahoo.com', 'hotmail.com', 'icloud.com', 'protonmail.com',
  'qq.com', '163.com', 'mail.ru', 'yandex.ru', 'company-mail.com', 'webmail.example.com',
];
const EMAIL_WEIGHTS = [34, 16, 12, 10, 9, 5, 4, 3, 2, 2, 2, 1];

interface CountryDef {
  code: string;
  currency: string;
  fx: number;
  bin: string;
  weight: number;
  cities: Array<[string, number]>;
}

const COUNTRIES: CountryDef[] = [
  { code: 'US', currency: 'USD', fx: 1, bin: '4539', weight: 34, cities: [['New York', 30], ['Los Angeles', 22], ['Chicago', 14], ['Houston', 10], ['Miami', 10], ['Seattle', 8], ['Atlanta', 6]] },
  { code: 'BR', currency: 'BRL', fx: 0.18, bin: '5162', weight: 11, cities: [['São Paulo', 40], ['Rio de Janeiro', 25], ['Belo Horizonte', 12], ['Curitiba', 10], ['Recife', 7], ['Porto Alegre', 6]] },
  { code: 'GB', currency: 'GBP', fx: 1.27, bin: '4926', weight: 8, cities: [['London', 50], ['Manchester', 15], ['Birmingham', 12], ['Leeds', 10], ['Glasgow', 8], ['Liverpool', 5]] },
  { code: 'CN', currency: 'CNY', fx: 0.14, bin: '6217', weight: 7, cities: [['Shanghai', 40], ['Beijing', 30], ['Shenzhen', 15], ['Hangzhou', 8], ['Chengdu', 7]] },
  { code: 'IN', currency: 'INR', fx: 0.012, bin: '4380', weight: 6, cities: [['Mumbai', 35], ['Delhi', 30], ['Bengaluru', 20], ['Chennai', 8], ['Kolkata', 7]] },
  { code: 'DE', currency: 'EUR', fx: 1.08, bin: '4011', weight: 5, cities: [['Berlin', 30], ['Munich', 25], ['Hamburg', 20], ['Cologne', 15], ['Frankfurt', 10]] },
  { code: 'NG', currency: 'NGN', fx: 0.00065, bin: '5061', weight: 4, cities: [['Lagos', 55], ['Abuja', 25], ['Kano', 10], ['Port Harcourt', 10]] },
  { code: 'MX', currency: 'MXN', fx: 0.055, bin: '4553', weight: 4, cities: [['Mexico City', 45], ['Guadalajara', 25], ['Monterrey', 20], ['Puebla', 10]] },
  { code: 'RU', currency: 'RUB', fx: 0.011, bin: '4276', weight: 4, cities: [['Moscow', 45], ['Saint Petersburg', 25], ['Novosibirsk', 15], ['Yekaterinburg', 15]] },
  { code: 'FR', currency: 'EUR', fx: 1.08, bin: '4970', weight: 3, cities: [['Paris', 60], ['Lyon', 15], ['Marseille', 12], ['Toulouse', 8], ['Nice', 5]] },
  { code: 'JP', currency: 'JPY', fx: 0.0068, bin: '3528', weight: 3, cities: [['Tokyo', 45], ['Osaka', 25], ['Nagoya', 15], ['Fukuoka', 10]] },
  { code: 'AU', currency: 'AUD', fx: 0.66, bin: '4565', weight: 2, cities: [['Sydney', 45], ['Melbourne', 35], ['Brisbane', 15], ['Perth', 5]] },
  { code: 'CA', currency: 'CAD', fx: 0.73, bin: '4519', weight: 2, cities: [['Toronto', 45], ['Vancouver', 25], ['Montreal', 20], ['Calgary', 10]] },
  { code: 'ZA', currency: 'ZAR', fx: 0.055, bin: '4580', weight: 2, cities: [['Johannesburg', 45], ['Cape Town', 30], ['Durban', 15], ['Pretoria', 10]] },
  { code: 'KR', currency: 'KRW', fx: 0.00074, bin: '4088', weight: 2, cities: [['Seoul', 60], ['Busan', 20], ['Incheon', 12], ['Daegu', 8]] },
  { code: 'AE', currency: 'AED', fx: 0.27, bin: '4202', weight: 2, cities: [['Dubai', 65], ['Abu Dhabi', 25], ['Sharjah', 10]] },
  { code: 'SG', currency: 'SGD', fx: 0.74, bin: '5248', weight: 1, cities: [['Singapore', 100]] },
  { code: 'TR', currency: 'TRY', fx: 0.031, bin: '4386', weight: 1, cities: [['Istanbul', 60], ['Ankara', 20], ['Izmir', 20]] },
  { code: 'VN', currency: 'VND', fx: 0.00004, bin: '4453', weight: 1, cities: [['Ho Chi Minh City', 55], ['Hanoi', 45]] },
];
const COUNTRY_INDEX = new Map(COUNTRIES.map((c, i) => [c.code, i]));

const MCC_CATALOG: Array<[string, string, number]> = [
  // mcc, name stem, weight
  ['5411', 'FreshMart', 16], ['5411', 'Sunrise Grocery', 10], ['5411', 'BlueBasket', 8],
  ['5812', 'Little Eatery', 12], ['5812', 'Urban Spice', 9], ['5812', 'Pasta House', 7],
  ['5541', 'NovaGas', 9], ['5541', 'SpeedFuel', 7],
  ['5912', 'CarePlus', 6], ['5912', 'MediSave', 4],
  ['5999', 'MarketSquare', 8], ['5999', 'The Emporium', 6],
  ['5311', 'Northline', 5], ['5311', 'WaveStyle', 4],
  ['4111', 'CityMetro', 5],
  ['5732', 'CircuitHub', 6], ['5732', 'TechNest', 5], ['5732', 'VoltElectro', 4],
  ['5816', 'GameForge', 5], ['5816', 'StreamPass', 4], ['5816', 'CloudBox', 3],
  ['7995', 'Royal Card Room', 2],
  ['7011', 'Blue Lagoon Hotels', 4], ['7011', 'Coastal Resorts', 3],
  ['4511', 'SkyBridge Air', 3], ['4511', 'FlyHigh', 2],
  ['5911', 'PaperTrail', 3], ['5992', 'PetPals', 2], ['7523', 'AutoCare', 2],
];

interface MerchantDef {
  name: string;
  mcc: string;
  countryIdx: number;
  cityIdx: number;
  weight: number;
  amountScale: number;
  channels: Array<[number, number]>;
}

interface CustomerDef {
  countryIdx: number;
  cityIdx: number;
  deviceIdx: number;
  altDeviceIdx: number;
  ipIdx: number;
  emailDomainIdx: number;
  phoneIdx: number;
  tenureDays: number;
  cardCount: number;
  firstCardIdx: number;
  spendProfile: number;
}

interface CardDef {
  customerIdx: number;
  countryIdx: number;
  bin: string;
  tenureDays: number;
}

interface RingPlan {
  id: number;
  name: string;
  color: string;
  memberCount: number;
  txnCount: number;
}

interface EventCols {
  n: number;
  ts: Float64Array;
  cust: Int32Array;
  card: Int32Array;
  device: Int32Array;
  ip: Int32Array;
  merchant: Int32Array;
  amount: Float64Array;
  channel: Uint8Array;
  entry: Uint8Array;
  threeDs: Uint8Array;
  newDevice: Uint8Array;
  status: Uint8Array;
  fraudKind: Uint8Array;
  ringId: Uint16Array;
  countryOverride: Int16Array;
}

export interface GenerateOptions {
  n?: number;
  seed?: number;
  days?: number;
  label?: string;
}

/** Convert a USD target into the local-currency amount that settles at that USD value. */
function usdToLocal(usd: number, countryIdx: number): number {
  const fx = COUNTRIES[countryIdx].fx || 1;
  return Math.round((usd / fx) * 100) / 100;
}

function pickCountry(rng: Rng): number {
  return rng.weighted(COUNTRIES.map((c, i) => [c.weight, i] as const));
}

function pickCity(rng: Rng, countryIdx: number): number {
  return rng.weighted(COUNTRIES[countryIdx].cities.map(([, w], i) => [w, i] as const));
}

function buildMerchants(rng: Rng): MerchantDef[] {
  const out: MerchantDef[] = [];
  MCC_CATALOG.forEach(([mcc, name, weight], i) => {
    const countryIdx = pickCountry(rng);
    const cityIdx = pickCity(rng, countryIdx);
    const city = COUNTRIES[countryIdx].cities[cityIdx][0];
    out.push({
      name: `${name} · ${city}`,
      mcc,
      countryIdx,
      cityIdx,
      weight,
      amountScale: rng.floatRange(0.5, 2.4),
      channels: channelsForMcc(mcc),
    });
    void i;
  });
  const stems = ['Express', 'Hub', 'Mart', 'Corner', 'Point', 'Store', 'Depot', 'House'];
  const prefixes = ['Sunny', 'Golden', 'Rapid', 'Prime', 'Smart', 'Swift', 'Urban', 'Reliable', 'Bright', 'Lucky'];
  const longTailMcc = ['5411', '5812', '5541', '5912', '5999', '5311', '4111', '5732', '7011', '4511', '5967', '5911'];
  for (let i = 0; i < 190; i++) {
    const countryIdx = pickCountry(rng);
    const cityIdx = pickCity(rng, countryIdx);
    const mcc = longTailMcc[i % longTailMcc.length];
    out.push({
      name: `${prefixes[i % prefixes.length]}${stems[i % stems.length]} ${100 + i}`,
      mcc,
      countryIdx,
      cityIdx,
      weight: rng.floatRange(0.2, 1.6),
      amountScale: rng.floatRange(0.4, 1.8),
      channels: channelsForMcc(mcc),
    });
  }
  return out;
}

function channelsForMcc(mcc: string): Array<[number, number]> {
  const onlineHeavy = ['5816', '7995', '5967', '5732', '4511', '7011'].includes(mcc);
  return [
    [onlineHeavy ? 0.6 : 0.32, CH_ECOM],
    [0.78, CH_POS],
    [0.93, CH_MOBILE],
    [1, CH_RECURRING],
  ];
}

function randomDiurnalTs(rng: Rng, days: number): number {
  const day = Math.floor(rng.float() * days);
  const u = rng.float();
  let hour: number;
  if (u < 0.62) hour = rng.int(9, 21);
  else if (u < 0.82) hour = rng.int(22, 23);
  else hour = rng.int(0, 8);
  return BASE_TS + day * DAY_MS + hour * 3_600_000 + rng.int(0, 59) * 60_000 + rng.int(0, 59) * 1000;
}

function entryFor(channel: number, rng: Rng): number {
  if (channel === CH_ECOM) return rng.bool(0.7) ? 3 : 4;
  if (channel === CH_POS) return rng.weighted([[45, 0], [35, 1], [15, 2], [5, 3]]);
  if (channel === CH_MOBILE) return rng.bool(0.8) ? 4 : 1;
  if (channel === CH_RECURRING) return 4;
  return 0;
}

export function generateDataset(opts: GenerateOptions = {}): Dataset {
  const started = performance.now();
  const targetN = Math.max(2000, Math.floor(opts.n ?? 200_000));
  const seed = opts.seed ?? 20260301;
  const days = opts.days ?? 30;
  const rng = new Rng(seed);
  const idRng = new Rng(seed ^ 0x9e3779b9);

  const merchants = buildMerchants(rng);
  const devices: string[] = [];
  const ips: Array<{ label: string; countryIdx: number }> = [];
  const customers: CustomerDef[] = [];
  const cards: CardDef[] = [];
  const phoneLabels: string[] = [];

  const nCustomers = Math.max(80, Math.round(targetN * 0.22));
  const deviceLabel = (countryIdx: number, c: number) =>
    `D${(0x4a0000 + countryIdx * 100000 + c).toString(16).toUpperCase()}`;

  const ringPlans: RingPlan[] = [
    { id: 1, name: '卡测团伙 · 批量试卡', color: '#ef4444', memberCount: Math.max(4, Math.round(nCustomers * 0.006)), txnCount: Math.round(targetN * 0.0055) },
    { id: 2, name: '跑分洗钱网络', color: '#f59e0b', memberCount: Math.max(4, Math.round(nCustomers * 0.004)), txnCount: Math.round(targetN * 0.0042) },
    { id: 3, name: '盗刷卡组织', color: '#8b5cf6', memberCount: Math.max(3, Math.round(nCustomers * 0.003)), txnCount: Math.round(targetN * 0.0035) },
    { id: 4, name: '退款套现团伙', color: '#06b6d4', memberCount: Math.max(3, Math.round(nCustomers * 0.002)), txnCount: Math.round(targetN * 0.0022) },
    { id: 5, name: '合成身份养号组', color: '#ec4899', memberCount: Math.max(5, Math.round(nCustomers * 0.006)), txnCount: Math.round(targetN * 0.0038) },
  ];
  const soloTarget = Math.round(targetN * 0.006);
  const ringTxnTotal = ringPlans.reduce((s, r) => s + r.txnCount, 0);
  const crossTarget = Math.round(targetN * 0.04);
  const legitTarget = Math.max(1000, targetN - ringTxnTotal - soloTarget - crossTarget);

  for (let c = 0; c < nCustomers; c++) {
    const countryIdx = pickCountry(rng);
    const cityIdx = pickCity(rng, countryIdx);
    const deviceIdx = devices.length;
    devices.push(deviceLabel(countryIdx, c));
    let altDeviceIdx = -1;
    if (rng.bool(0.16)) {
      altDeviceIdx = devices.length;
      devices.push(`D${(0x5b0000 + countryIdx * 100000 + c).toString(16).toUpperCase()}`);
    }
    // 18% of customers share a household IP with an earlier customer
    let ipIdx: number;
    if (rng.bool(0.18) && c > 5) {
      const partner = Math.floor(rng.float() * Math.min(c, 60));
      ipIdx = customers[partner].ipIdx;
    } else {
      ipIdx = ips.length;
      ips.push({ label: `10.${countryIdx * 7 + cityIdx}.${c & 0xff}.${(c >> 8) & 0xff}`, countryIdx });
    }
    let emailDomainIdx = 0;
    {
      const local = `u${c.toString(36)}${idRng.int(0, 9999).toString(36)}`;
      let h = 0;
      for (let i = 0; i < local.length; i++) h = (h * 31 + local.charCodeAt(i)) >>> 0;
      let r = h % 100;
      for (let i = 0; i < EMAIL_WEIGHTS.length; i++) {
        r -= EMAIL_WEIGHTS[i];
        if (r < 0) { emailDomainIdx = i; break; }
      }
    }
    let phoneIdx: number;
    if (rng.bool(0.24) && c > 4) {
      phoneIdx = customers[Math.floor(rng.float() * Math.min(c, 50))].phoneIdx;
    } else {
      phoneIdx = phoneLabels.length;
      phoneLabels.push(`PH${idRng.int(100000, 999999)}${idRng.int(10, 99)}`);
    }
    const tenureDays = rng.weighted([[18, rng.int(0, 30)], [30, rng.int(30, 365)], [52, rng.int(365, 3650)]]);
    const cardCount = rng.weighted([[52, 1], [30, 2], [13, 3], [5, 4]]);
    const firstCardIdx = cards.length;
    for (let k = 0; k < cardCount; k++) {
      cards.push({ customerIdx: c, countryIdx, bin: COUNTRIES[countryIdx].bin, tenureDays: Math.min(tenureDays, rng.int(0, Math.max(1, tenureDays))) });
    }
    customers.push({
      countryIdx, cityIdx, deviceIdx, altDeviceIdx, ipIdx, emailDomainIdx, phoneIdx,
      tenureDays, cardCount, firstCardIdx, spendProfile: rng.lognormal(0, 0.55),
    });
  }
  const legitCustomerCount = customers.length;
  const phoneLabelFor = (idx: number): string => phoneLabels[idx] ?? `PH${idx}`;

  const capacity = legitTarget + ringTxnTotal + soloTarget + crossTarget + 1000;
  const ev = makeEvents(capacity);
  let e = 0;
  const push = (
    ts: number, cust: number, card: number, device: number, ip: number, merchant: number,
    amount: number, channel: number, entry: number, threeDs: 0 | 1, newDevice: 0 | 1,
    status: number, fraudKind: 0 | 1 | 2, ringId: number, countryOverride = -1,
  ) => {
    const i = e++;
    ev.ts[i] = ts; ev.cust[i] = cust; ev.card[i] = card; ev.device[i] = device;
    ev.ip[i] = ip; ev.merchant[i] = merchant; ev.amount[i] = amount;
    ev.channel[i] = channel; ev.entry[i] = entry; ev.threeDs[i] = threeDs;
    ev.newDevice[i] = newDevice; ev.status[i] = status; ev.fraudKind[i] = fraudKind;
    ev.ringId[i] = ringId; ev.countryOverride[i] = countryOverride;
  };

  const customerPicker = new WeightedPicker(customers.map((_, i) => 1 / (1 + (i % 400) * 0.03)));
  const merchantPicker = new WeightedPicker(merchants.map((m) => m.weight));
  const pickCustomer = () => customerPicker.pickIndex(rng);
  const pickMerchant = () => merchantPicker.pickIndex(rng);
  const pickMerchantByMcc = (mccs: string[]): number => {
    const list: Array<[number, number]> = [];
    for (let i = 0; i < merchants.length; i++) if (mccs.includes(merchants[i].mcc)) list.push([merchants[i].weight, i]);
    return list.length ? rng.weighted(list) : pickMerchant();
  };

  // ---- legitimate baseline ----
  for (let t = 0; t < legitTarget; t++) {
    const c = pickCustomer();
    const customer = customers[c];
    const cardIdx = customer.firstCardIdx + rng.int(0, customer.cardCount - 1);
    const useAlt = customer.altDeviceIdx >= 0 && rng.bool(0.3);
    const deviceIdx = useAlt ? customer.altDeviceIdx : customer.deviceIdx;
    const mIdx = pickMerchant();
    const merchant = merchants[mIdx];
    const channel = rng.weighted(merchant.channels);
    const raw = rng.lognormal(2.7 + Math.log(merchant.amountScale), 0.75) * customer.spendProfile;
    const amount = Math.round(Math.max(0.5, Math.min(raw, 15_000)) * 100) / 100;
    const threeDs: 0 | 1 = (channel === CH_ECOM ? rng.bool(0.42) : channel === CH_MOBILE ? rng.bool(0.2) : rng.bool(0.08)) ? 1 : 0;
    const status = rng.weighted([[80, 0], [15, 1], [5, 2]]);
    const crossBorder = channel === CH_ECOM && merchant.countryIdx !== customer.countryIdx && rng.bool(0.5);
    push(
      randomDiurnalTs(rng, days), c, cardIdx, deviceIdx, customer.ipIdx, mIdx, amount, channel,
      entryFor(channel, rng), threeDs, useAlt && rng.bool(0.5) ? 1 : 0, status, 0, 0,
      crossBorder ? merchant.countryIdx : -1,
    );
  }

  // ---- cross-border / travel traffic (legit but unusual) ----
  for (let t = 0; t < crossTarget; t++) {
    const c = pickCustomer();
    const customer = customers[c];
    const mIdx = pickMerchant();
    push(
      randomDiurnalTs(rng, days), c, customer.firstCardIdx, customer.deviceIdx, customer.ipIdx, mIdx,
      Math.round(rng.lognormal(3.4, 0.85) * 100) / 100, CH_ECOM, 3, rng.bool(0.72) ? 1 : 0, 1, 0, 0, 0,
      pickCountry(rng),
    );
  }
  const sharedPhoneBase = phoneLabels.length;
  for (const label of ['PHRING-A', 'PHRING-B', 'PHSC-1', 'PHSC-2', 'PHSYN-1']) phoneLabels.push(label);

  // ================= fraud rings =================

  // Ring 1 — card testing: shared devices/IPs, many cards, tiny amounts, one casino MCC
  const r1 = ringPlans[0];
  {
    const cCountry = COUNTRY_INDEX.get('NG')!;
    const devStart = devices.length;
    for (let i = 0; i < 4; i++) devices.push(`CT-${i}D`);
    const ipStart = ips.length;
    for (let i = 0; i < 6; i++) ips.push({ label: `ip-ct-${i}.ring1`, countryIdx: cCountry });
    const mStart = merchants.length;
    merchants.push({ name: 'LuckySpin Casino', mcc: '7995', countryIdx: cCountry, cityIdx: 0, weight: 0, amountScale: 0.1, channels: [[1, CH_ECOM]] });
    const custStart = customers.length;
    for (let i = 0; i < r1.memberCount; i++) {
      const firstCardIdx = cards.length;
      const cardCount = rng.int(3, 8);
      for (let k = 0; k < cardCount; k++) cards.push({ customerIdx: custStart + i, countryIdx: cCountry, bin: '5399', tenureDays: rng.int(0, 15) });
      customers.push({
        countryIdx: cCountry, cityIdx: 0, deviceIdx: devStart + (i % 4), altDeviceIdx: -1,
        ipIdx: ipStart + (i % 6), emailDomainIdx: 6, phoneIdx: sharedPhoneBase + (i % 2),
        tenureDays: rng.int(1, 40), cardCount, firstCardIdx, spendProfile: 0.5,
      });
    }
    for (let i = 0; i < r1.txnCount; i++) {
      const member = custStart + rng.int(0, r1.memberCount - 1);
      const customer = customers[member];
      const burstDay = Math.floor(rng.float() * days * 0.9);
      const ts = BASE_TS + burstDay * DAY_MS + rng.int(0, 45) * 60_000 + rng.int(0, 59_000);
      push(
        ts, member, customer.firstCardIdx + rng.int(0, customer.cardCount - 1),
        devStart + rng.int(0, 3), ipStart + rng.int(0, 5), mStart,
        usdToLocal(rng.floatRange(0.4, 3.2), cCountry), CH_ECOM, 3, 0, 1,
        rng.weighted([[72, 1], [20, 0], [8, 2]]), 1, r1.id, cCountry,
      );
    }
  }

  // Ring 2 — laundering mules: high-volume round amounts through 2 digital-goods merchants
  const r2 = ringPlans[1];
  {
    const cCountry = COUNTRY_INDEX.get('BR')!;
    const mStart = merchants.length;
    for (let i = 0; i < 2; i++) merchants.push({ name: `Nova Digital Goods ${i + 1}`, mcc: '5816', countryIdx: cCountry, cityIdx: 0, weight: 0, amountScale: 4, channels: [[1, CH_ECOM]] });
    const devStart = devices.length;
    for (let i = 0; i < 5; i++) devices.push(`NL-${i}D`);
    const ipStart = ips.length;
    for (let i = 0; i < 4; i++) ips.push({ label: `ip-nl-${i}.ring2`, countryIdx: cCountry });
    const custStart = customers.length;
    for (let i = 0; i < r2.memberCount; i++) {
      const firstCardIdx = cards.length;
      cards.push({ customerIdx: custStart + i, countryIdx: cCountry, bin: '5162', tenureDays: rng.int(30, 700) });
      customers.push({
        countryIdx: cCountry, cityIdx: 0, deviceIdx: devStart + (i % 5), altDeviceIdx: -1,
        ipIdx: ipStart + (i % 4), emailDomainIdx: 5, phoneIdx: sharedPhoneBase + 2,
        tenureDays: rng.int(20, 900), cardCount: 1, firstCardIdx, spendProfile: 2.2,
      });
    }
    for (let i = 0; i < r2.txnCount; i++) {
      const member = custStart + rng.int(0, r2.memberCount - 1);
      const customer = customers[member];
      const ts = BASE_TS + Math.floor(rng.float() * days * 0.9) * DAY_MS + rng.int(0, 23) * 3_600_000;
      push(
        ts, member, customer.firstCardIdx, customer.deviceIdx, customer.ipIdx, mStart + rng.int(0, 1),
        usdToLocal(rng.int(120, 2400) + 0.99, cCountry), CH_ECOM, 4, 0, 0, 0, 1, r2.id, cCountry,
      );
    }
  }

  // Ring 3 — stolen cards: US-issued cards used from NG/BR devices, high amounts, short bursts
  const r3 = ringPlans[2];
  {
    const usCountry = COUNTRY_INDEX.get('US')!;
    const ngCountry = COUNTRY_INDEX.get('NG')!;
    const brCountry = COUNTRY_INDEX.get('BR')!;
    const devStart = devices.length;
    for (let i = 0; i < 6; i++) devices.push(`SC-${i}D`);
    const ipStart = ips.length;
    for (let i = 0; i < 5; i++) ips.push({ label: `ip-sc-${i}.ring3`, countryIdx: i % 2 ? brCountry : ngCountry });
    const mStart = merchants.length;
    for (let i = 0; i < 2; i++) merchants.push({ name: `CircuitHub Outlet ${i + 1}`, mcc: '5732', countryIdx: usCountry, cityIdx: 0, weight: 0, amountScale: 30, channels: [[1, CH_ECOM]] });
    const stolenCount = Math.max(10, Math.round(r3.memberCount * 6));
    const cardStart = cards.length;
    const holderCount = Math.max(4, Math.round(stolenCount / 3));
    const holderStart = customers.length;
    for (let i = 0; i < holderCount; i++) {
      const firstCardIdx = cards.length;
      const heldCards = Math.ceil(stolenCount / holderCount);
      const take = Math.min(heldCards, stolenCount - (cards.length - cardStart));
      for (let k = 0; k < take; k++) cards.push({ customerIdx: holderStart + i, countryIdx: ngCountry, bin: '4539', tenureDays: rng.int(60, 2000) });
      customers.push({
        countryIdx: ngCountry, cityIdx: 0, deviceIdx: devStart + (i % 6), altDeviceIdx: -1,
        ipIdx: ipStart + (i % 5), emailDomainIdx: 8, phoneIdx: -1,
        tenureDays: rng.int(30, 400), cardCount: take, firstCardIdx, spendProfile: 1.8,
      });
    }
    let remaining = r3.txnCount;
    for (let i = 0; i < stolenCount && remaining > 0; i++) {
      const cardCustomer = holderStart + Math.floor((i * holderCount) / stolenCount);
      const burstStart = BASE_TS + Math.floor(rng.float() * days * 0.85) * DAY_MS + rng.int(0, 20) * 3_600_000;
      const uses = Math.min(remaining, i === stolenCount - 1 ? remaining : rng.int(2, 5));
      remaining -= uses;
      for (let k = 0; k < uses; k++) {
        push(
          burstStart + rng.int(0, 40) * 60_000, cardCustomer, cardStart + i,
          devStart + rng.int(0, 5), ipStart + rng.int(0, 4), mStart + rng.int(0, 1),
          Math.round(rng.floatRange(650, 4200) * 100) / 100, CH_ECOM, 2, 0, 1,
          rng.weighted([[65, 0], [35, 1]]), 1, r3.id, usCountry,
        );
      }
    }
  }

  // Ring 4 — refund abuse: recurring hotel charges, shared phones, unusually high amounts
  const r4 = ringPlans[3];
  {
    const cCountry = COUNTRY_INDEX.get('AE')!;
    const mStart = merchants.length;
    merchants.push({ name: 'Blue Lagoon Resorts', mcc: '7011', countryIdx: cCountry, cityIdx: 0, weight: 0, amountScale: 12, channels: [[1, CH_RECURRING]] });
    const devStart = devices.length;
    for (let i = 0; i < 5; i++) devices.push(`RF-${i}D`);
    const ipStart = ips.length;
    for (let i = 0; i < 3; i++) ips.push({ label: `ip-rf-${i}.ring4`, countryIdx: cCountry });
    const custStart = customers.length;
    for (let i = 0; i < r4.memberCount; i++) {
      const firstCardIdx = cards.length;
      cards.push({ customerIdx: custStart + i, countryIdx: cCountry, bin: '4202', tenureDays: rng.int(100, 1500) });
      customers.push({
        countryIdx: cCountry, cityIdx: 0, deviceIdx: devStart + (i % 5), altDeviceIdx: -1,
        ipIdx: ipStart + (i % 3), emailDomainIdx: 1, phoneIdx: sharedPhoneBase + 2,
        tenureDays: rng.int(10, 500), cardCount: 1, firstCardIdx, spendProfile: 1.3,
      });
    }
    for (let i = 0; i < r4.txnCount; i++) {
      const member = custStart + rng.int(0, r4.memberCount - 1);
      const customer = customers[member];
      const ts = BASE_TS + Math.floor(rng.float() * days * 0.95) * DAY_MS + rng.int(0, 23) * 3_600_000;
      push(
        ts, member, customer.firstCardIdx, customer.deviceIdx, customer.ipIdx, mStart,
        usdToLocal(rng.floatRange(180, 1400), cCountry), CH_RECURRING, 4, 1, 0, 2, 1, r4.id, cCountry,
      );
    }
  }

  // Ring 5 — synthetic identities: new accounts, shared device pool, one GameForge merchant
  const r5 = ringPlans[4];
  {
    const cCountry = COUNTRY_INDEX.get('IN')!;
    const devStart = devices.length;
    for (let i = 0; i < 5; i++) devices.push(`SYN-${i}D`);
    const ipStart = ips.length;
    for (let i = 0; i < 6; i++) ips.push({ label: `ip-syn-${i}.ring5`, countryIdx: cCountry });
    const mStart = merchants.length;
    for (let i = 0; i < 3; i++) merchants.push({ name: `GameForge Account ${i + 1}`, mcc: '5816', countryIdx: cCountry, cityIdx: 0, weight: 0, amountScale: 1, channels: [[1, CH_ECOM]] });
    const custStart = customers.length;
    for (let i = 0; i < r5.memberCount; i++) {
      const firstCardIdx = cards.length;
      cards.push({ customerIdx: custStart + i, countryIdx: cCountry, bin: '4381', tenureDays: 1 });
      customers.push({
        countryIdx: cCountry, cityIdx: 0, deviceIdx: devStart + (i % 5), altDeviceIdx: -1,
        ipIdx: ipStart + (i % 6), emailDomainIdx: 10, phoneIdx: sharedPhoneBase + 4,
        tenureDays: rng.int(0, 6), cardCount: 1, firstCardIdx, spendProfile: 0.7,
      });
    }
    for (let i = 0; i < r5.txnCount; i++) {
      const member = custStart + rng.int(0, r5.memberCount - 1);
      const customer = customers[member];
      const ts = BASE_TS + Math.floor(rng.float() * days * 0.9) * DAY_MS + rng.int(0, 23) * 3_600_000 + rng.int(0, 59) * 60_000;
      push(
        ts, member, customer.firstCardIdx, customer.deviceIdx, customer.ipIdx, mStart + rng.int(0, 2),
        usdToLocal(rng.floatRange(4, 90), cCountry), CH_ECOM, 4, 0, 1, 0, 1, r5.id, cCountry,
      );
    }
  }

  // ---- solo fraud: stolen US cards, no shared infrastructure ----
  {
    const usCountry = COUNTRY_INDEX.get('US')!;
    const soloDevStart = devices.length;
    for (let i = 0; i < 40; i++) devices.push(`SD-${i}D`);
    const stolenStart = cards.length;
    const stolenCount = Math.max(30, Math.round(soloTarget * 0.8));
    for (let i = 0; i < stolenCount; i++) cards.push({ customerIdx: -1, countryIdx: usCountry, bin: '4539', tenureDays: rng.int(30, 2500) });
    for (let i = 0; i < soloTarget && e < capacity; i++) {
      const ts = BASE_TS + Math.floor(rng.float() * days * 0.98) * DAY_MS + rng.int(0, 23) * 3_600_000;
      push(
        ts, rng.int(0, legitCustomerCount - 1), stolenStart + rng.int(0, stolenCount - 1),
        soloDevStart + rng.int(0, 39), rng.int(0, ips.length - 1),
        pickMerchantByMcc(['5732', '5816', '5999', '7011', '4511']),
        Math.round(rng.floatRange(400, 3000) * 100) / 100, CH_ECOM, 3, 0, 1,
        rng.weighted([[60, 0], [40, 1]]), 2, 0, usCountry,
      );
    }
  }

  // pad or trim to the exact requested size
  while (e < targetN && e < capacity) {
    const c = pickCustomer();
    const customer = customers[c];
    const mIdx = pickMerchant();
    push(
      randomDiurnalTs(rng, days), c, customer.firstCardIdx, customer.deviceIdx, customer.ipIdx, mIdx,
      Math.round(rng.lognormal(3.1, 0.9) * 100) / 100, CH_ECOM, 3, rng.bool(0.4) ? 1 : 0, 0, 0, 0, 0,
    );
  }
  if (e > targetN) e = targetN;
  ev.n = e;
  const order = sortByTs(ev.ts, e);

  const cols = buildColumns(ev, order, {
    customers, cards, devices, ips, merchants, phoneLabel: phoneLabelFor, days,
  });

  const truthCols: TruthColumns = {
    fraud: new Uint8Array(e),
    ring: new Uint16Array(e),
    ringNames: ['', ...ringPlans.map((r) => r.name)],
  };
  for (let i = 0; i < e; i++) {
    const src = order[i];
    truthCols.fraud[i] = ev.fraudKind[src];
    truthCols.ring[i] = ev.ringId[src];
  }

  const summary = summarize(cols, truthCols, ringPlans);
  summary.label = opts.label ?? `演示数据 · ${e.toLocaleString('en-US')} 笔 · ${days} 天`;
  summary.notes = `种子 ${seed} · 内置 ${ringPlans.length} 个欺诈团伙 + 单人盗刷`;
  summary.generatedInMs = Math.round(performance.now() - started);

  return { summary, cols, truth: truthCols };
}

function makeEvents(capacity: number): EventCols {
  return {
    n: 0,
    ts: new Float64Array(capacity),
    cust: new Int32Array(capacity),
    card: new Int32Array(capacity),
    device: new Int32Array(capacity),
    ip: new Int32Array(capacity),
    merchant: new Int32Array(capacity),
    amount: new Float64Array(capacity),
    channel: new Uint8Array(capacity),
    entry: new Uint8Array(capacity),
    threeDs: new Uint8Array(capacity),
    newDevice: new Uint8Array(capacity),
    status: new Uint8Array(capacity),
    fraudKind: new Uint8Array(capacity),
    ringId: new Uint16Array(capacity),
    countryOverride: new Int16Array(capacity).fill(-1),
  };
}

function sortByTs(ts: Float64Array, n: number): Uint32Array {
  const idx = new Uint32Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  // Two-pass stable LSD radix sort on the 32-bit millisecond offset, then stable
  // pass on second-level offset for datasets beyond ~49 days.
  const keys = new Uint32Array(n);
  for (let i = 0; i < n; i++) keys[i] = Math.floor(ts[i] - BASE_TS) >>> 0;
  const tmp = new Uint32Array(n);
  const count = new Uint32Array(65536);
  let src = idx;
  let dst = tmp;
  for (let shift = 0; shift < 32; shift += 16) {
    count.fill(0);
    for (let i = 0; i < n; i++) count[(keys[src[i]] >>> shift) & 0xffff]++;
    let sum = 0;
    for (let i = 0; i < 65536; i++) { const c = count[i]; count[i] = sum; sum += c; }
    for (let i = 0; i < n; i++) { const v = src[i]; dst[count[(keys[v] >>> shift) & 0xffff]++] = v; }
    [src, dst] = [dst, src];
  }
  return src === idx ? idx : new Uint32Array(src);
}

interface BuildAux {
  customers: CustomerDef[];
  cards: CardDef[];
  devices: string[];
  ips: Array<{ label: string; countryIdx: number }>;
  merchants: MerchantDef[];
  phoneLabel: (idx: number) => string;
  days: number;
}

function buildColumns(ev: EventCols, order: Uint32Array, aux: BuildAux): Columns {
  const n = order.length;
  const b = new ColumnBuilder(n);
  const { customers, cards, devices, ips, merchants } = aux;
  const binCache = new Map<number, string>();

  for (let i = 0; i < n; i++) {
    b.beginRow();
    const e = order[i];
    const ts = ev.ts[e];
    const customer = customers[ev.cust[e]];
    const card = cards[ev.card[e]];
    const merchant = merchants[ev.merchant[e]];
    const ip = ips[ev.ip[e]];
    const deviceLabel = devices[ev.device[e]] ?? 'UNKNOWN';
    const countryIdx = ev.countryOverride[e] >= 0 ? ev.countryOverride[e] : customer.countryIdx;
    const country = COUNTRIES[countryIdx];
    const cityIdx = customer.cityIdx % country.cities.length;
    const currency = country.currency;
    const amount = ev.amount[e];

    // 30% of cross-border ecom charges settle in the merchant's currency
    const settleCurrency = ev.channel[e] === CH_ECOM && merchant.countryIdx !== countryIdx && (e & 3) === 0
      ? COUNTRIES[merchant.countryIdx].currency
      : currency;
    const fx = COUNTRIES.find((c) => c.currency === settleCurrency)?.fx ?? 1;
    const amountUsd = Math.round(amount * fx * 100) / 100;

    b.setFloat('ts', ts);
    b.setFloat('amount', Math.round(amount * 100) / 100);
    b.setFloat('amount_usd', amountUsd);

    const date = new Date(ts);
    b.setInt('hour', date.getUTCHours());
    b.setInt('weekday', date.getUTCDay());
    b.setInt('is_new_device', ev.newDevice[e] === 1);
    b.setInt('is_3ds', ev.threeDs[e] === 1);
    b.setFloat('customer_tenure_days', Math.max(0, customer.tenureDays));
    b.setFloat('card_tenure_days', Math.max(0, Math.min(3000, card?.tenureDays ?? 0)));

    let cardHash = binCache.get(ev.card[e]);
    if (!cardHash) {
      cardHash = `C${card?.bin ?? '0000'}${(0x3f0000 + ev.card[e]).toString(16).toUpperCase()}`;
      binCache.set(ev.card[e], cardHash);
    }

    b.setCat('id', `TXN-${(BASE_TS / 1000 + i).toString(36).toUpperCase()}-${i.toString(36).padStart(5, '0')}`);
    b.setCat('currency', settleCurrency);
    b.setCat('channel', CHANNELS[ev.channel[e]]);
    b.setCat('entry_mode', ENTRY_MODES[ev.entry[e]]);
    b.setCat('mcc', merchant.mcc);
    b.setCat('merchant_id', `M${(ev.merchant[e] + 1000).toString(36).toUpperCase()}`);
    b.setCat('merchant_name', merchant.name);
    b.setCat('merchant_country', COUNTRIES[merchant.countryIdx].code);
    b.setCat('country', country.code);
    b.setCat('city', country.cities[cityIdx][0]);
    b.setCat('card_hash', cardHash);
    b.setCat('card_bin', card?.bin ?? '0000');
    b.setCat('card_country', card && card.countryIdx >= 0 ? COUNTRIES[card.countryIdx].code : country.code);
    b.setCat('device_id', deviceLabel);
    b.setCat('ip', ip.label);
    b.setCat('ip_country', COUNTRIES[ip.countryIdx].code);
    b.setCat('customer_id', `CU${(0x9a00 + ev.cust[e]).toString(16).toUpperCase()}`);
    b.setCat('email_hash', `${(0x715000 + ev.cust[e]).toString(16)}@${EMAIL_DOMAINS[customer.emailDomainIdx]}`);
    b.setCat('phone_hash', aux.phoneLabel(customer.phoneIdx));
    b.setCat('status', STATUSES[ev.status[e]]);
  }
  return b.finish();
}

function summarize(cols: Columns, truth: TruthColumns, plans: RingPlan[]): DatasetSummary {
  let total = 0;
  for (let i = 0; i < cols.n; i++) total += cols.floats.amount_usd[i];
  const ringTxns = new Map<number, number>();
  const ringAmount = new Map<number, number>();
  let fraudCount = 0;
  for (let i = 0; i < cols.n; i++) {
    if (truth.fraud[i] > 0) {
      fraudCount++;
      const r = truth.ring[i];
      if (r > 0) {
        ringTxns.set(r, (ringTxns.get(r) ?? 0) + 1);
        ringAmount.set(r, (ringAmount.get(r) ?? 0) + cols.floats.amount_usd[i]);
      }
    }
  }
  return {
    n: cols.n,
    label: '',
    source: 'demo',
    startedAt: cols.floats.ts[0] ?? 0,
    endedAt: cols.floats.ts[cols.n - 1] ?? 0,
    totalAmountUsd: Math.round(total),
    fraudulent: fraudCount,
    ringCount: plans.length,
    rings: plans.map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      txns: ringTxns.get(p.id) ?? 0,
      amountUsd: Math.round(ringAmount.get(p.id) ?? 0),
    })) as DatasetSummary['rings'],
    cards: cols.cats.card_hash.dict.length - 1,
    customers: cols.cats.customer_id.dict.length - 1,
    devices: cols.cats.device_id.dict.length - 1,
    ips: cols.cats.ip.dict.length - 1,
    merchants: cols.cats.merchant_id.dict.length - 1,
    countries: cols.cats.country.dict.length - 1,
    hasLabels: true,
  };
}

export { COUNTRIES, CHANNELS, ENTRY_MODES, STATUSES, EMAIL_DOMAINS };
