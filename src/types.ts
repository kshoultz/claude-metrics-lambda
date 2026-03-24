// ============================================================================
// Claude Metrics Response — the shaped output
// ============================================================================

export interface ClaudeMetricsResponse {
  capacity: {
    claude_api: CapacityMetrics;
    claude_code: (CapacityMetrics & {
      per_user: { email: string; tokens_used: number }[];
    }) | null;
  };
  cost: CostMetrics;
  usage: {
    claude_api: UsageBreakdown;
    claude_code: (UsageBreakdown & {
      per_user: {
        email: string;
        tokens: number;
        models_used: string[];
      }[];
    }) | null;
  };
  account: AccountInfo;
  billing_period: BillingPeriod;
  meta: {
    fetched_at: string;
    api_version: string;
  };
}

export interface CapacityMetrics {
  tokens_used: number;
  token_limit: number;
  tokens_remaining: number;
  usage_pct: number;
  daily_burn_rate: number;
  projected_tokens_at_period_end: number;
  days_until_exhaustion: number | null;
}

export interface CostMetrics {
  current_spend_usd: number;
  projected_spend_usd: number;
  daily_burn_rate_usd: number;
  by_model: { model: string; cost_usd: number; tokens_used: number }[];
  daily: { date: string; cost_usd: number }[];
}

export interface UsageBreakdown {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  by_model: { model: string; tokens: number }[];
  daily: { date: string; tokens: number }[];
}

export interface AccountInfo {
  organization_name: string;
  organization_id: string;
  workspaces: { id: string; name: string; archived: boolean }[];
  members: { id: string; name: string; email: string; role: string }[];
  api_keys: {
    total: number;
    active: number;
    keys: {
      id: string;
      name: string;
      status: string;
      workspace_id: string | null;
    }[];
  };
}

export interface BillingPeriod {
  start: string;
  end: string;
  days_total: number;
  days_elapsed: number;
  days_remaining: number;
  resets_at: string;
}

// ============================================================================
// Raw Anthropic Admin API response types
// ============================================================================

// GET /v1/organizations/me
export interface RawOrganization {
  id: string;
  name: string;
  created_at?: string;
}

// GET /v1/organizations/usage_report/messages
export interface RawUsageReport {
  data: RawUsageBucket[];
  has_more: boolean;
  next_page?: string;
}

export interface RawUsageBucket {
  starting_at: string;
  results: RawUsageResult[];
}

export interface RawUsageResult {
  uncached_input_tokens: number;
  cache_read_input_tokens: number;
  output_tokens: number;
  cache_creation?: {
    ephemeral_5m_input_tokens?: number;
    ephemeral_1h_input_tokens?: number;
  };
  model?: string;
  api_key_id?: string;
  workspace_id?: string;
}

// GET /v1/organizations/cost_report
export interface RawCostReport {
  data: RawCostBucket[];
  has_more: boolean;
  next_page?: string;
}

export interface RawCostBucket {
  starting_at: string;
  results: RawCostResult[];
}

export interface RawCostResult {
  amount: string; // cents as decimal string
  model?: string;
  workspace_id?: string;
}

// GET /v1/organizations/usage_report/claude_code
export interface RawClaudeCodeReport {
  data: RawClaudeCodeRecord[];
  has_more: boolean;
  next_page?: string;
}

export interface RawClaudeCodeRecord {
  date: string;
  actor: {
    type: string;
    email_address: string;
    name?: string;
  };
  model_breakdown: {
    model: string;
    tokens: {
      input: number;
      output: number;
      cache_read: number;
      cache_creation: number;
    };
    estimated_cost: {
      amount: number; // cents
      currency: string;
    };
  }[];
}

// GET /v1/organizations/workspaces
export interface RawWorkspacesResponse {
  data: RawWorkspace[];
  has_more: boolean;
  first_id?: string;
  last_id?: string;
}

export interface RawWorkspace {
  id: string;
  name: string;
  display_name?: string;
  created_at: string;
  archived_at?: string | null;
}

// GET /v1/organizations/users
export interface RawMembersResponse {
  data: RawMember[];
  has_more: boolean;
  first_id?: string;
  last_id?: string;
}

export interface RawMember {
  id: string;
  name: string;
  email: string;
  role: string;
  created_at: string;
}

// GET /v1/organizations/api_keys
export interface RawApiKeysResponse {
  data: RawApiKey[];
  has_more: boolean;
  first_id?: string;
  last_id?: string;
}

export interface RawApiKey {
  id: string;
  name: string;
  status: string;
  workspace_id?: string | null;
  created_at: string;
  created_by?: {
    id: string;
    name: string;
  };
}
