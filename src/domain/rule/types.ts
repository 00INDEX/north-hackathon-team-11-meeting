export type RuleTargetType = "room" | "resource";
export type RuleType = "open_hours" | "periodic_block" | "one_time_block";

export interface AvailabilityRule {
  id: string;
  targetType: RuleTargetType;
  targetId: string;
  ruleType: RuleType;
  reason: string;
  enabled: boolean;
  isSystem: boolean;
  recurrence?: string;
  start: string;
  end: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAvailabilityRuleInput {
  id: string;
  targetType: RuleTargetType;
  targetId: string;
  ruleType: RuleType;
  reason: string;
  enabled?: boolean;
  isSystem?: boolean;
  recurrence?: string;
  start: string;
  end: string;
  version?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface UpdateAvailabilityRuleInput {
  targetType?: RuleTargetType;
  targetId?: string;
  ruleType?: RuleType;
  reason?: string;
  enabled?: boolean;
  recurrence?: string;
  start?: string;
  end?: string;
  version?: number;
}
