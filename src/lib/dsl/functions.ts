export type FieldType = 'number' | 'string' | 'boolean' | 'timestamp';

export interface FieldSpec {
  name: string;
  type: FieldType;
  label: string;
  description: string;
  enum?: string[];
}

export const FIELDS: FieldSpec[] = [
  { name: 'amount', type: 'number', label: '交易金额', description: '原始币种金额' },
  { name: 'amount_usd', type: 'number', label: '美元金额', description: '折算美元后的金额' },
  { name: 'currency', type: 'string', label: '币种', description: 'ISO-4217 币种代码', enum: ['USD', 'EUR', 'GBP', 'CNY', 'JPY', 'BRL', 'INR'] },
  { name: 'ts', type: 'timestamp', label: '交易时间', description: 'Unix 毫秒时间戳' },
  { name: 'hour', type: 'number', label: '小时', description: '交易发生的小时 0-23' },
  { name: 'weekday', type: 'number', label: '星期', description: '0=周日 … 6=周六' },
  { name: 'channel', type: 'string', label: '通道', description: '交易通道', enum: ['ecom', 'pos', 'mobile', 'recurring', 'atm'] },
  { name: 'entry_mode', type: 'string', label: '读卡方式', description: '信息录入方式', enum: ['chip', 'contactless', 'swipe', 'manual', 'token'] },
  { name: 'mcc', type: 'string', label: 'MCC', description: '商户类别码' },
  { name: 'merchant_id', type: 'string', label: '商户号', description: '收单商户 ID' },
  { name: 'merchant_name', type: 'string', label: '商户名', description: '商户名称' },
  { name: 'merchant_country', type: 'string', label: '商户国家', description: '商户所在国家' },
  { name: 'country', type: 'string', label: '交易国家', description: '交易发起国家' },
  { name: 'city', type: 'string', label: '交易城市', description: '交易发起城市' },
  { name: 'card_hash', type: 'string', label: '卡号哈希', description: '卡号脱敏哈希（主键之一）' },
  { name: 'card_bin', type: 'string', label: '卡 BIN', description: '卡号前 6-8 位' },
  { name: 'card_country', type: 'string', label: '发卡国家', description: '发卡行国家' },
  { name: 'device_id', type: 'string', label: '设备 ID', description: '设备指纹' },
  { name: 'ip', type: 'string', label: 'IP', description: '客户端 IP' },
  { name: 'ip_country', type: 'string', label: 'IP 国家', description: 'IP 归属国家' },
  { name: 'customer_id', type: 'string', label: '客户 ID', description: '账户/客户 ID' },
  { name: 'email_hash', type: 'string', label: '邮箱哈希', description: '邮箱脱敏哈希' },
  { name: 'phone_hash', type: 'string', label: '手机号哈希', description: '手机号脱敏哈希' },
  { name: 'is_new_device', type: 'boolean', label: '新设备', description: '该客户首次在此设备交易' },
  { name: 'is_3ds', type: 'boolean', label: '3DS', description: '是否通过 3DS 验证' },
  { name: 'customer_tenure_days', type: 'number', label: '客户账龄', description: '客户开户天数' },
  { name: 'card_tenure_days', type: 'number', label: '卡龄', description: '卡片使用天数' },
  { name: 'status', type: 'string', label: '状态', description: '授权结果', enum: ['approved', 'declined', 'pending'] },
];

export const FIELD_MAP = new Map(FIELDS.map((f) => [f.name, f]));

export type FnCategory = 'aggregate' | 'list' | 'string' | 'math' | 'time' | 'logic';

export interface FnSpec {
  name: string;
  category: FnCategory;
  signature: string;
  summary: string;
  example: string;
  /** For aggregates: kind used by the engine. */
  aggKind?: 'count' | 'sum' | 'avg' | 'min' | 'max' | 'distinct';
  /** Aggregate functions take (value?, window, keys...) */
  supportsFilter?: boolean;
}

export const FUNCTIONS: FnSpec[] = [
  { name: 'count', category: 'aggregate', signature: 'count(window, key1, key2?, ...)', summary: '窗口内符合条件的交易笔数；不传字段时统计行数', example: 'count(10m, card_hash) > 5', aggKind: 'count', supportsFilter: true },
  { name: 'sum', category: 'aggregate', signature: 'sum(field, window, key1, key2?, ...)', summary: '窗口内金额/字段求和', example: 'sum(amount_usd, 10m, card_hash) > 5000', aggKind: 'sum', supportsFilter: true },
  { name: 'avg', category: 'aggregate', signature: 'avg(field, window, key1, ...)', summary: '窗口内平均值', example: 'avg(amount_usd, 30m, customer_id) > 400', aggKind: 'avg', supportsFilter: true },
  { name: 'min', category: 'aggregate', signature: 'min(field, window, key1, ...)', summary: '窗口内最小值', example: 'min(amount_usd, 1h, device_id) < 1', aggKind: 'min', supportsFilter: true },
  { name: 'max', category: 'aggregate', signature: 'max(field, window, key1, ...)', summary: '窗口内最大值', example: 'max(amount_usd, 24h, card_hash) > 3000', aggKind: 'max', supportsFilter: true },
  { name: 'distinct', category: 'aggregate', signature: 'distinct(field, window, key1, ...)', summary: '窗口内某字段的去重计数（如一个 IP 关联多少张卡）', example: 'distinct(card_hash, 24h, ip) >= 5', aggKind: 'distinct', supportsFilter: true },
  { name: 'in_list', category: 'list', signature: 'in_list(field, "list_id")', summary: '实体是否命中名单（黑/白/观察）', example: 'in_list(card_hash, "blacklist_cards")' },
  { name: 'not_in_list', category: 'list', signature: 'not_in_list(field, "list_id")', summary: '实体未命中名单', example: 'not_in_list(device_id, "whitelist_devices")' },
  { name: 'matches', category: 'string', signature: 'matches(field, "regex")', summary: '正则匹配（区分大小写）', example: 'matches(merchant_name, "^.+_LIQUOR$")' },
  { name: 'contains', category: 'string', signature: 'contains(field, "text")', summary: '子串包含', example: 'contains(email_hash, "qq")' },
  { name: 'starts_with', category: 'string', signature: 'starts_with(field, "prefix")', summary: '前缀匹配', example: 'starts_with(card_bin, "4")' },
  { name: 'ends_with', category: 'string', signature: 'ends_with(field, "suffix")', summary: '后缀匹配', example: 'ends_with(ip, ".0")' },
  { name: 'len', category: 'string', signature: 'len(x)', summary: '字符串长度 / 数组长度', example: 'len(card_hash) == 32' },
  { name: 'lower', category: 'string', signature: 'lower(x)', summary: '转小写', example: 'lower(country) == "us"' },
  { name: 'upper', category: 'string', signature: 'upper(x)', summary: '转大写', example: 'upper(currency) == "USD"' },
  { name: 'abs', category: 'math', signature: 'abs(x)', summary: '绝对值', example: 'abs(amount_usd) > 10000' },
  { name: 'round', category: 'math', signature: 'round(x, digits?)', summary: '四舍五入', example: 'round(amount_usd, 2)' },
  { name: 'coalesce', category: 'math', signature: 'coalesce(a, b, ...)', summary: '返回第一个非空值', example: 'coalesce(card_tenure_days, 0) < 7' },
  { name: 'hour_of', category: 'time', signature: 'hour_of(ts)', summary: '时间戳的小时 0-23', example: 'hour_of(ts) >= 1 and hour_of(ts) <= 5' },
  { name: 'weekday_of', category: 'time', signature: 'weekday_of(ts)', summary: '时间戳的星期 0-6', example: 'weekday_of(ts) == 0' },
];

export const FN_MAP = new Map(FUNCTIONS.map((f) => [f.name, f]));
export const AGG_FN_NAMES = new Set(FUNCTIONS.filter((f) => f.category === 'aggregate').map((f) => f.name));
