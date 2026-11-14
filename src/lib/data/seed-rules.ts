import type { RuleGroup, RuleList, RulePackage, Rule } from '../types';

export const SEED_GROUPS: RuleGroup[] = [
  { id: 'g_lists', name: '名单拦截', priority: 900, enabled: true, description: '命中黑名单立即拦截，白名单直接放行。', color: '#ef4444' },
  { id: 'g_stolen', name: '盗卡与仿冒', priority: 800, enabled: true, description: '跨地域刷卡、短时高频大额、卡测特征。', color: '#8b5cf6' },
  { id: 'g_velocity', name: '交易频次', priority: 600, enabled: true, description: '同一卡/设备/IP 在滑动窗口内的笔数与金额。', color: '#f59e0b' },
  { id: 'g_linkage', name: '关联网络', priority: 500, enabled: true, description: '设备、IP 关联的多卡多账户行为。', color: '#06b6d4' },
  { id: 'g_account', name: '账户与身份', priority: 400, enabled: true, description: '新账户、新设备、合成身份特征。', color: '#ec4899' },
  { id: 'g_amounts', name: '金额与商户', priority: 300, enabled: false, description: '高风险 MCC 与大额交易。默认关组，供灰度试验。', color: '#22c55e' },
  { id: 'g_allow', name: '放行策略', priority: 1000, enabled: true, description: '白名单与低风险例外，优先级最高。', color: '#10b981' },
];

export const SEED_LISTS: RuleList[] = [
  {
    id: 'blacklist_cards', name: 'black_cards', label: '已知盗刷卡', kind: 'black', entity_type: 'card',
    entries: ['C4539X3F0001', 'C4539X3F0002', 'C4539X3F0017'],
    description: '来自卡组织与内部分析的确认盗刷卡哈希。', updated_at: 0,
  },
  {
    id: 'blacklist_devices', name: 'black_devices', label: '欺诈设备指纹', kind: 'black', entity_type: 'device',
    entries: ['CT-0D', 'SC-1D'],
    description: '在历史案件中被确认用于欺诈的设备。', updated_at: 0,
  },
  {
    id: 'ip_egress_risk', name: 'risky_ips', label: '高风险出口 IP', kind: 'watch', entity_type: 'ip',
    entries: ['ip-ct-0.ring1', 'ip-sc-0.ring3'],
    description: '代理池 / 已被标记的数据中心出口 IP（观察，不直接拦截）。', updated_at: 0,
  },
  {
    id: 'whitelist_customers', name: 'trusted_customers', label: 'VIP 可信客户', kind: 'white', entity_type: 'customer',
    entries: ['CU9A01', 'CU9A02', 'CU9A03', 'CU9A04', 'CU9A05', 'CU9A06', 'CU9A07', 'CU9A08'],
    description: '长期低风险的大额客户，可直接放行。', updated_at: 0,
  },
  {
    id: 'whitelist_devices', name: 'trusted_devices', label: '可信设备', kind: 'white', entity_type: 'device',
    entries: [],
    description: '经过强认证的常用设备。', updated_at: 0,
  },
  {
    id: 'watch_phones', name: 'shared_phones', label: '共享手机号', kind: 'watch', entity_type: 'phone',
    entries: ['PHRING-A', 'PHRING-B', 'PHSC-1', 'PHSC-2', 'PHSYN-1'],
    description: '同一手机号被多个账户注册使用，典型养号特征。', updated_at: 0,
  },
];

let nextRuleSeq = 0;
function r(
  id: string, name: string, group_id: string, priority: number, action: Rule['action'],
  severity: Rule['severity'], expression: string, reason: string, mode: Rule['mode'] = 'enforce',
  rollout = 100, tags: string[] = [],
): Rule {
  nextRuleSeq++;
  return {
    id, name, group_id, priority, enabled: true, mode, rollout, action, severity,
    expression, reason, tags, updated_at: 0,
  };
}

export const SEED_RULES: Rule[] = [
  r('R000', 'VIP 可信客户放行', 'g_allow', 1, 'allow', 'low',
    'in_list(customer_id, "whitelist_customers") and amount_usd < 20000',
    '白名单客户的小额交易直接放行，优先级最高，先于所有拦截规则评估。', 'enforce', 100, ['名单', '放行']),
  r('R001', '命中已知盗刷卡', 'g_lists', 10, 'block', 'critical',
    'in_list(card_hash, "blacklist_cards")', '卡哈希在确认盗刷名单中。', 'enforce', 100, ['名单']),
  r('R002', '命中欺诈设备', 'g_lists', 20, 'block', 'critical',
    'in_list(device_id, "blacklist_devices") and amount_usd > 50',
    '设备指纹在欺诈设备名单中，且非极小额试卡。', 'enforce', 100, ['名单']),
  r('R101', '高风险 IP + 大额', 'g_stolen', 10, 'block', 'high',
    'in_list(ip, "ip_egress_risk") and amount_usd > 300',
    '高风险出口 IP 上发起大额交易。', 'shadow', 0, ['IP', '灰度']),
  r('R102', '跨地域盗刷', 'g_stolen', 20, 'block', 'high',
    'card_country == "US" and ip_country in ["NG", "BR"] and amount_usd > 500',
    '美国发卡，却在尼日利亚/巴西 IP 上大额消费。', 'enforce', 100, ['地域']),
  r('R103', '卡测特征：小额高频多卡', 'g_stolen', 30, 'review', 'high',
    'count(10m, card_hash) >= 4 and sum(amount_usd, 10m, card_hash) < 40',
    '同卡 10 分钟内 ≥4 笔且合计不足 40 美元，典型批量试卡。', 'enforce', 100, ['试卡', '窗口']),
  r('R104', '短时大额连刷', 'g_stolen', 40, 'block', 'high',
    'count(30m, card_hash) >= 3 and sum(amount_usd, 30m, card_hash) > 3000',
    '同卡 30 分钟内连刷 3 笔以上、合计超 3000 美元。', 'enforce', 100, ['窗口', '金额']),
  r('R201', '同卡 10 分钟高频', 'g_velocity', 10, 'review', 'medium',
    'count(10m, card_hash) >= 6',
    '同卡 10 分钟交易笔数 ≥6。', 'shadow', 0, ['窗口', '灰度']),
  r('R202', '同设备 1 小时多卡', 'g_velocity', 20, 'review', 'high',
    'distinct(card_hash, 1h, device_id, ip) >= 4',
    '同设备+IP 1 小时内尝试 ≥4 张不同卡。', 'enforce', 100, ['窗口', '关联']),
  r('R203', '同 IP 1 小时多卡', 'g_velocity', 30, 'challenge', 'medium',
    'distinct(card_hash, 1h, ip) >= 6',
    '同一 IP 1 小时内出现 ≥6 张卡。', 'shadow', 0, ['窗口', 'IP', '灰度']),
  r('R301', '设备关联多账户', 'g_linkage', 10, 'review', 'high',
    'distinct(customer_id, 24h, device_id) >= 4',
    '同一设备 24 小时内关联 ≥4 个账户。', 'enforce', 100, ['关联']),
  r('R302', 'IP 关联多账户', 'g_linkage', 20, 'review', 'medium',
    'distinct(customer_id, 24h, ip) >= 5',
    '同一 IP 24 小时内关联 ≥5 个账户。', 'shadow', 0, ['关联', '灰度']),
  r('R303', '两个窗口串联的设备异常', 'g_linkage', 30, 'block', 'high',
    'count(10m, device_id) >= 5 and distinct(card_hash, 1h, device_id) >= 3',
    '设备 10 分钟内 ≥5 笔，且 1 小时内 ≥3 张卡。', 'enforce', 100, ['关联', '窗口']),
  r('R401', '新账户首笔大额', 'g_account', 10, 'review', 'medium',
    'customer_tenure_days < 7 and amount_usd > 200',
    '开户不足 7 天即发生 200 美元以上交易。', 'enforce', 100, ['新账户']),
  r('R402', '新卡大额线上', 'g_account', 20, 'challenge', 'medium',
    'card_tenure_days < 5 and amount_usd > 400 and channel == "ecom"',
    '新卡（<5 天）在电商通道大额消费。', 'shadow', 0, ['新卡', '灰度']),
  r('R403', '共享手机号 + 多账户', 'g_account', 30, 'review', 'high',
    'in_list(phone_hash, "watch_phones") and distinct(customer_id, 24h, phone_hash) >= 3',
    '同一手机号被 ≥3 个账户使用。', 'enforce', 100, ['名单', '关联']),
  r('R501', '高风险 MCC 夜间大额', 'g_amounts', 10, 'review', 'medium',
    'mcc in ["7995", "5967", "5816"] and hour_of(ts) >= 1 and hour_of(ts) <= 5 and amount_usd > 800',
    '凌晨时段在赌博/直邮/数字商品商户大额消费。', 'shadow', 0, ['商户', '灰度']),
  r('R502', '汇率异常：本地币种 · 跨境商户', 'g_amounts', 20, 'challenge', 'low',
    'currency == "USD" and merchant_country != country and amount_usd > 1500',
    '境外商户但按美元结算的大额交易。', 'shadow', 0, ['商户', '灰度']),
];

export function seedPackage(): RulePackage {
  return {
    groups: structuredClone(SEED_GROUPS),
    rules: structuredClone(SEED_RULES),
    lists: structuredClone(SEED_LISTS),
    settings: { whitelist_bypass: true, min_amount_for_block: 1 },
  };
}
