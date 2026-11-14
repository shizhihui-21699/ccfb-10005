export type Severity = 'low' | 'medium' | 'high' | 'critical';
export type Action = 'block' | 'challenge' | 'review' | 'record' | 'allow';
export type RuleMode = 'off' | 'shadow' | 'enforce';

export interface Rule {
  id: string;
  name: string;
  group_id: string;
  priority: number;
  enabled: boolean;
  mode: RuleMode;
  /** Percent of traffic where an enforce rule is actually enforced. 0 = pure shadow. */
  rollout: number;
  action: Action;
  severity: Severity;
  expression: string;
  reason: string;
  tags: string[];
  updated_at: number;
}

export interface RuleGroup {
  id: string;
  name: string;
  priority: number;
  enabled: boolean;
  description: string;
  color?: string;
}

export type ListKind = 'black' | 'white' | 'watch';
export type ListEntityType = 'card' | 'device' | 'ip' | 'customer' | 'email' | 'phone';

export interface RuleList {
  id: string;
  name: string;
  label: string;
  kind: ListKind;
  entity_type: ListEntityType;
  entries: string[];
  description?: string;
  updated_at: number;
}

export interface RuleSettings {
  whitelist_bypass: boolean;
  min_amount_for_block?: number;
}

export interface RulePackage {
  groups: RuleGroup[];
  rules: Rule[];
  lists: RuleList[];
  settings: RuleSettings;
}

export interface RuleVersion {
  id: string;
  seq: number;
  name: string;
  note: string;
  author: string;
  created_at: number;
  base_version_id?: string;
  /** Set when this version was produced by rolling back to another version. */
  rolled_back_from?: string;
  package: RulePackage;
  published: boolean;
}

export interface TxnRecord {
  id: string;
  ts: number;
  amount: number;
  amount_usd: number;
  currency: string;
  channel: string;
  mcc: string;
  merchant_id: string;
  merchant_name: string;
  merchant_country: string;
  country: string;
  city: string;
  card_hash: string;
  card_bin: string;
  card_country: string;
  device_id: string;
  ip: string;
  ip_country: string;
  customer_id: string;
  email_hash: string;
  phone_hash: string;
  status: string;
  entry_mode: string;
  is_3ds: boolean;
  is_new_device: boolean;
  hour: number;
  weekday: number;
  customer_tenure_days: number;
  card_tenure_days: number;
  [key: string]: unknown;
}

export interface TxnTruth {
  is_fraud: boolean;
  kind?: 'ring' | 'solo' | 'legit';
  ring_id?: string;
}

export interface DataBundle {
  source: 'demo' | 'upload';
  label: string;
  seed?: number;
  txns: TxnRecord[];
  truth: TxnTruth[] | null;
  has_labels: boolean;
  started_at: number;
  ended_at: number;
  notes?: string;
}
