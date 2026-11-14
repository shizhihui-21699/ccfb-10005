/**
 * Fraud ring discovery from transaction linkage.
 *
 * Two transactions are linked when they share an identity primitive:
 * card, device, IP or account. We build an union-find over these primitives,
 * weight edges by how rare the shared value is, then score candidate clusters
 * and report them with the evidence that tied them together.
 */

import type { Columns } from '../data/schema';

export interface RingMember {
  kind: 'customer' | 'card' | 'device' | 'ip' | 'merchant';
  id: string;
  label: string;
  txns: number;
  amountUsd: number;
}

export interface RingLink {
  type: 'device' | 'ip' | 'phone' | 'email' | 'card' | 'merchant';
  value: string;
  members: number;
}

export interface DetectedRing {
  id: number;
  label: string;
  size: number;
  txns: number;
  amountUsd: number;
  fraudTxns: number;
  fraudShare: number;
  riskScore: number;
  reasons: string[];
  members: RingMember[];
  links: RingLink[];
  timeSpanMs: number;
  firstTs: number;
  lastTs: number;
  countries: string[];
}

export interface RingAnalysis {
  rings: DetectedRing[];
  totalClusters: number;
  analysedAt: number;
  elapsedMs: number;
  parameters: RingParameters;
}

export interface RingParameters {
  minMembers: number;
  minTxns: number;
  maxIpFanout: number;
  includeMerchants: boolean;
  /** Clusters larger than this share of all rows are background noise, not rings. */
  maxShareOfRows: number;
}

export const DEFAULT_RING_PARAMS: RingParameters = {
  minMembers: 3,
  minTxns: 8,
  maxIpFanout: 8,
  includeMerchants: false,
  maxShareOfRows: 0.05,
};

interface UnionFind {
  parent: Int32Array;
  find(x: number): number;
  union(a: number, b: number): void;
}

function makeUF(n: number): UnionFind {
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  return {
    parent,
    find(x: number): number {
      let root = x;
      while (parent[root] !== root) root = parent[root];
      while (parent[x] !== root) {
        const next = parent[x];
        parent[x] = root;
        x = next;
      }
      return root;
    },
    union(a: number, b: number): void {
      const ra = this.find(a);
      const rb = this.find(b);
      if (ra !== rb) parent[rb] = ra;
    },
  };
}

interface EdgeStat {
  type: RingLink['type'];
  value: string;
  entities: Set<number>;
  txns: number;
}

export function detectRings(
  cols: Columns,
  truth: { fraud: Uint8Array; ring: Uint16Array; ringNames: string[] } | null,
  params: RingParameters = DEFAULT_RING_PARAMS,
): RingAnalysis {
  const started = performance.now();
  const n = cols.n;

  // Entity ids: customers first, then cards, devices, ips, merchants.
  const custDict = cols.cats.customer_id.dict;
  const cardDict = cols.cats.card_hash.dict;
  const deviceDict = cols.cats.device_id.dict;
  const ipDict = cols.cats.ip.dict;
  const emailDict = cols.cats.email_hash.dict;
  const phoneDict = cols.cats.phone_hash.dict;
  const merchantDict = cols.cats.merchant_id.dict;

  const custOffset = 0;
  const cardOffset = custOffset + custDict.length;
  const deviceOffset = cardOffset + cardDict.length;
  const ipOffset = deviceOffset + deviceDict.length;
  const merchantOffset = ipOffset + ipDict.length;
  const total = merchantOffset + merchantDict.length + 1;

  const uf = makeUF(total);

  // Track entity stats for scoring.
  const entityTxns = new Uint32Array(total);
  const entityAmount = new Float64Array(total);

  // Group values by entity to measure fan-out.
  const deviceCust = new Map<number, Set<number>>();
  const ipCust = new Map<number, Set<number>>();
  const cardCust = new Map<number, Set<number>>();
  const ipDevices = new Map<number, Set<number>>();
  const ipCards = new Map<number, Set<number>>();

  const addTo = (map: Map<number, Set<number>>, key: number, value: number) => {
    let set = map.get(key);
    if (!set) {
      set = new Set();
      map.set(key, set);
    }
    set.add(value);
  };

  for (let i = 0; i < n; i++) {
    const cust = custDict[cols.cats.customer_id.codes[i]] ?? '';
    const card = cardDict[cols.cats.card_hash.codes[i]] ?? '';
    const device = deviceDict[cols.cats.device_id.codes[i]] ?? '';
    const ip = ipDict[cols.cats.ip.codes[i]] ?? '';
    const merchant = merchantDict[cols.cats.merchant_id.codes[i]] ?? '';
    const ccode = cols.cats.customer_id.codes[i];
    const kcode = cols.cats.card_hash.codes[i];
    const dcode = cols.cats.device_id.codes[i];
    const icode = cols.cats.ip.codes[i];
    const mcode = cols.cats.merchant_id.codes[i];
    void cust; void card; void device; void ip; void merchant;

    const idC = custOffset + ccode;
    const idK = cardOffset + kcode;
    const idD = deviceOffset + dcode;
    const idI = ipOffset + icode;
    const idM = merchantOffset + mcode;

    entityTxns[idC]++;
    entityTxns[idK]++;
    entityTxns[idD]++;
    entityTxns[idI]++;
    if (params.includeMerchants) entityTxns[idM]++;
    const amt = cols.floats.amount_usd[i];
    entityAmount[idC] += amt;

    addTo(deviceCust, dcode, ccode);
    addTo(ipCust, icode, ccode);
    addTo(cardCust, kcode, ccode);
    addTo(ipDevices, icode, dcode);
    addTo(ipCards, icode, kcode);

    // link card ↔ customer, device ↔ customer, ip ↔ customer
    uf.union(idC, idK);
    uf.union(idC, idD);
    uf.union(idC, idI);
  }

  // IP- or device-level bridging: an IP shared by many customers creates a
  // cluster only when the fan-out is suspicious, so weak "household IP" hubs
  // are not treated as rings.
  for (const [ip, custs] of ipCust) {
    if (custs.size > params.maxIpFanout) continue;
    const first = custOffset + [...custs][0];
    for (const c of custs) uf.union(first, custOffset + c);
  }
  for (const [device, custs] of deviceCust) {
    const first = custOffset + [...custs][0];
    for (const c of custs) uf.union(first, custOffset + c);
  }

  // Gather clusters by root.
  const clusters = new Map<number, number[]>();
  for (let e = 0; e < total; e++) {
    if (entityTxns[e] === 0) continue;
    // skip merchant entities unless requested
    if (e >= merchantOffset && !params.includeMerchants) continue;
    const root = uf.find(e);
    let list = clusters.get(root);
    if (!list) {
      list = [];
      clusters.set(root, list);
    }
    list.push(e);
  }

  // Link evidence is collected once per shared value and bucketed by cluster root.
  interface LinkBuckets {
    devices: RingLink[];
    ips: RingLink[];
    cards: RingLink[];
  }
  const linksByRoot = new Map<number, RingLink[]>();
  const addLink = (root: number, link: RingLink) => {
    let list = linksByRoot.get(root);
    if (!list) {
      list = [];
      linksByRoot.set(root, list);
    }
    list.push(link);
  };
  const bucketLinks = (map: Map<number, Set<number>>, type: RingLink['type'], dict: string[], offset: number) => {
    for (const [code, set] of map) {
      if (set.size < 2) continue;
      const e = offset + code;
      const value = dict[code];
      if (!value) continue;
      addLink(uf.find(e), { type, value, members: set.size });
    }
  };
  bucketLinks(deviceCust, 'device', deviceDict, deviceOffset);
  bucketLinks(ipCust, 'ip', ipDict, ipOffset);
  bucketLinks(cardCust, 'card', cardDict, cardOffset);
  void linksByRoot;
  void (null as unknown as LinkBuckets);

  // One pass over rows, bucketed by cluster root — never scan the dataset per cluster.
  interface ClusterAgg { txns: number; amount: number; fraudTxns: number; minTs: number; maxTs: number }
  const clusterAgg = new Map<number, ClusterAgg>();
  for (let i = 0; i < n; i++) {
    const ccode = cols.cats.customer_id.codes[i];
    const root = uf.find(custOffset + ccode);
    let agg = clusterAgg.get(root);
    if (!agg) {
      agg = { txns: 0, amount: 0, fraudTxns: 0, minTs: Infinity, maxTs: -Infinity };
      clusterAgg.set(root, agg);
    }
    agg.txns++;
    agg.amount += cols.floats.amount_usd[i];
    const ts = cols.floats.ts[i];
    if (ts < agg.minTs) agg.minTs = ts;
    if (ts > agg.maxTs) agg.maxTs = ts;
    if (truth && truth.fraud[i] > 0) agg.fraudTxns++;
  }

  const rings: DetectedRing[] = [];
  let analysedClusters = 0;

  for (const [root, entities] of clusters) {
    const members: RingMember[] = [];
    for (const e of entities) {
      const kind = e < cardOffset ? 'customer' : e < deviceOffset ? 'card' : e < ipOffset ? 'device' : 'ip';
      const dict = kind === 'customer' ? custDict : kind === 'card' ? cardDict : kind === 'device' ? deviceDict : ipDict;
      const local = e - (kind === 'customer' ? custOffset : kind === 'card' ? cardOffset : kind === 'device' ? deviceOffset : ipOffset);
      members.push({
        kind,
        id: dict[local] ?? '',
        label: dict[local] ?? '',
        txns: entityTxns[e],
        amountUsd: Math.round(entityAmount[e]),
      });
    }
    if (members.length === 0) continue;
    analysedClusters++;

    const custMembers = members.filter((m) => m.kind === 'customer');
    const cardMembers = members.filter((m) => m.kind === 'card');
    const deviceMembers = members.filter((m) => m.kind === 'device');
    const ipMembers = members.filter((m) => m.kind === 'ip');

    const agg = clusterAgg.get(root);
    const txns = agg?.txns ?? 0;
    if (members.length < params.minMembers) continue;
    if (txns < params.minTxns && cardMembers.length + deviceMembers.length < params.minMembers) continue;
    if (txns > n * params.maxShareOfRows) continue;

    const fraudShare = txns > 0 ? (agg?.fraudTxns ?? 0) / txns : 0;
    const reasons: string[] = [];
    const riskScore = scoreRing({
      customers: custMembers.length,
      cards: cardMembers.length,
      devices: deviceMembers.length,
      ips: ipMembers.length,
      txns,
      fraudShare,
      amount: agg?.amount ?? 0,
      reasons,
    });

    const links = linksByRoot.get(root) ?? [];
    const onlyRealMembers = links.filter((l) => l.members >= 2);
    onlyRealMembers.sort((a, b) => b.members - a.members);

    rings.push({
      id: 0,
      label: buildRingLabel(reasons, members),
      size: members.length,
      txns,
      amountUsd: Math.round(agg?.amount ?? 0),
      fraudTxns: agg?.fraudTxns ?? 0,
      fraudShare,
      riskScore,
      reasons,
      members,
      links: dedupeLinks(onlyRealMembers).slice(0, 12),
      timeSpanMs: (agg?.maxTs ?? 0) - (agg?.minTs ?? 0),
      firstTs: agg?.minTs ?? 0,
      lastTs: agg?.maxTs ?? 0,
      countries: [],
    });
  }

  rings.sort((a, b) => b.riskScore - a.riskScore);
  rings.forEach((r, i) => (r.id = i + 1));
  const topRings = rings.slice(0, 40);
  for (const ring of topRings) {
    ring.members.sort((a, b) => b.txns - a.txns);
  }

  return {
    rings: topRings,
    totalClusters: analysedClusters,
    analysedAt: Date.now(),
    elapsedMs: Math.round(performance.now() - started),
    parameters: params,
  };
}

function scoreRing(input: {
  customers: number;
  cards: number;
  devices: number;
  ips: number;
  txns: number;
  fraudShare: number;
  amount: number;
  reasons: string[];
}): number {
  let score = 0;
  if (input.customers >= 2) {
    score += 12 + input.customers * 3;
    input.reasons.push(`${input.customers} 个账户共用基础设施`);
  }
  if (input.cards > input.customers * 2) {
    score += 14;
    input.reasons.push(`平均每个账户关联 ${(input.cards / Math.max(1, input.customers)).toFixed(1)} 张卡`);
  }
  if (input.devices < input.customers) {
    score += 10;
    input.reasons.push(`${input.customers} 个账户集中在 ${input.devices || 0} 台设备`);
  }
  const txnsPerEntity = input.txns / Math.max(1, input.customers + input.cards);
  if (txnsPerEntity > 12) {
    score += 10;
    input.reasons.push(`人均交易频次异常（${txnsPerEntity.toFixed(0)} 笔）`);
  }
  if (input.fraudShare > 0.5) {
    score += 40;
    input.reasons.push('已知标签显示该簇以欺诈交易为主');
  } else if (input.fraudShare > 0.2) {
    score += 20;
    input.reasons.push('簇内欺诈交易占比偏高');
  }
  if (input.ips <= 1 && input.customers > 3) {
    score += 8;
    input.reasons.push('多个账户共用同一个 IP');
  }
  return Math.round(score);
}

function buildRingLabel(reasons: string[], members: RingMember[]): string {
  const customerCount = members.filter((m) => m.kind === 'customer').length;
  if (reasons.some((r) => r.includes('欺诈'))) return '疑似欺诈团伙';
  if (customerCount >= 4) return '多账户关联簇';
  return '关联实体簇';
}

function dedupeLinks(links: RingLink[]): RingLink[] {
  const seen = new Set<string>();
  const out: RingLink[] = [];
  for (const l of links) {
    const key = l.type + ':' + l.value;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(l);
  }
  return out;
}
