/**
 * Aggregator — shapes raw Anthropic Admin API responses into ClaudeMetricsResponse.
 *
 * Ports proven math from gravitywell-api's token_usage_service.py:
 * - Token summation across daily buckets
 * - Cost aggregation (cents → USD)
 * - Monthly cost projection (linear extrapolation)
 *
 * Adds: burn rate, exhaustion projection, by-model grouping, per-user breakdown.
 */

import type {
  AccountInfo,
  BillingPeriod,
  CapacityMetrics,
  ClaudeMetricsResponse,
  CostMetrics,
  RawApiKeysResponse,
  RawClaudeCodeRecord,
  RawClaudeCodeReport,
  RawCostBucket,
  RawCostReport,
  RawMembersResponse,
  RawOrganization,
  RawUsageBucket,
  RawUsageReport,
  RawWorkspacesResponse,
  UsageBreakdown,
} from "./types.js";

const DEFAULT_TOKEN_LIMIT = 50_000_000; // 50M tokens

// ============================================================================
// Billing Period
// ============================================================================

export function getBillingPeriod(now = new Date()): BillingPeriod {
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
  );
  const endOfMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)
  );
  const daysTotal = Math.round(
    (endOfMonth.getTime() - start.getTime()) / 86_400_000
  );
  const daysElapsed = Math.max(
    (now.getTime() - start.getTime()) / 86_400_000,
    0
  );
  const daysRemaining = Math.max(daysTotal - daysElapsed, 0);

  return {
    start: start.toISOString(),
    end: endOfMonth.toISOString(),
    days_total: daysTotal,
    days_elapsed: round2(daysElapsed),
    days_remaining: round2(daysRemaining),
    resets_at: endOfMonth.toISOString(),
  };
}

/**
 * Build list of YYYY-MM-DD date strings from period start to now.
 */
export function getDateRange(periodStart: Date, now: Date): string[] {
  const dates: string[] = [];
  const current = new Date(periodStart);
  while (current <= now) {
    dates.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

// ============================================================================
// Token Summation (ported from Python _sum_tokens)
// ============================================================================

export function sumTokens(buckets: RawUsageBucket[]): number {
  let total = 0;
  for (const bucket of buckets) {
    for (const result of bucket.results ?? []) {
      total += result.uncached_input_tokens ?? 0;
      total += result.cache_read_input_tokens ?? 0;
      total += result.output_tokens ?? 0;
      const cache = result.cache_creation;
      if (cache) {
        total += cache.ephemeral_5m_input_tokens ?? 0;
        total += cache.ephemeral_1h_input_tokens ?? 0;
      }
    }
  }
  return total;
}

/** Sum tokens broken down by type for the usage breakdown section. */
export function sumTokensByType(buckets: RawUsageBucket[]): {
  input: number;
  output: number;
  cache_read: number;
  cache_creation: number;
} {
  let input = 0;
  let output = 0;
  let cache_read = 0;
  let cache_creation = 0;

  for (const bucket of buckets) {
    for (const result of bucket.results ?? []) {
      input += result.uncached_input_tokens ?? 0;
      output += result.output_tokens ?? 0;
      cache_read += result.cache_read_input_tokens ?? 0;
      const cache = result.cache_creation;
      if (cache) {
        cache_creation += cache.ephemeral_5m_input_tokens ?? 0;
        cache_creation += cache.ephemeral_1h_input_tokens ?? 0;
      }
    }
  }

  return { input, output, cache_read, cache_creation };
}

// ============================================================================
// Cost Summation (ported from Python _sum_cost_cents / _cents_to_usd)
// ============================================================================

/** Sum cost across buckets. Amounts are in cents as decimal strings. */
export function sumCostCents(buckets: RawCostBucket[]): number {
  let totalCents = 0;
  for (const bucket of buckets) {
    for (const result of bucket.results ?? []) {
      totalCents += parseFloat(result.amount ?? "0");
    }
  }
  return totalCents;
}

/** Convert cents to USD, rounded to 2 decimal places. */
export function centsToUsd(cents: number): number {
  return round2(cents / 100);
}

// ============================================================================
// Cost Projection (ported from Python _project_monthly_cost)
// ============================================================================

/** Project monthly cost based on linear extrapolation of spend-to-date. */
export function projectMonthlyCost(
  currentCostUsd: number,
  daysElapsed: number,
  daysTotal: number
): number {
  if (daysElapsed <= 0) return currentCostUsd;
  const dailyRate = currentCostUsd / daysElapsed;
  return round2(dailyRate * daysTotal);
}

// ============================================================================
// By-Model Grouping
// ============================================================================

/** Group usage buckets by model, summing tokens per model. */
export function groupUsageByModel(
  buckets: RawUsageBucket[]
): { model: string; tokens: number }[] {
  const map = new Map<string, number>();
  for (const bucket of buckets) {
    for (const result of bucket.results ?? []) {
      const model = result.model ?? "unknown";
      const tokens =
        (result.uncached_input_tokens ?? 0) +
        (result.cache_read_input_tokens ?? 0) +
        (result.output_tokens ?? 0) +
        (result.cache_creation?.ephemeral_5m_input_tokens ?? 0) +
        (result.cache_creation?.ephemeral_1h_input_tokens ?? 0);
      map.set(model, (map.get(model) ?? 0) + tokens);
    }
  }
  return Array.from(map.entries())
    .map(([model, tokens]) => ({ model, tokens }))
    .sort((a, b) => b.tokens - a.tokens);
}

/** Group cost buckets by model, summing cost per model. */
export function groupCostByModel(
  buckets: RawCostBucket[],
  usageBuckets: RawUsageBucket[]
): { model: string; cost_usd: number; tokens_used: number }[] {
  const costMap = new Map<string, number>();
  for (const bucket of buckets) {
    for (const result of bucket.results ?? []) {
      const model = result.model ?? "unknown";
      const cents = parseFloat(result.amount ?? "0");
      costMap.set(model, (costMap.get(model) ?? 0) + cents);
    }
  }

  const tokensByModel = groupUsageByModel(usageBuckets);
  const tokenMap = new Map(tokensByModel.map((m) => [m.model, m.tokens]));

  return Array.from(costMap.entries())
    .map(([model, cents]) => ({
      model,
      cost_usd: centsToUsd(cents),
      tokens_used: tokenMap.get(model) ?? 0,
    }))
    .sort((a, b) => b.cost_usd - a.cost_usd);
}

// ============================================================================
// Daily Breakdown
// ============================================================================

/** Build daily token totals from usage buckets. */
export function dailyTokenBreakdown(
  buckets: RawUsageBucket[]
): { date: string; tokens: number }[] {
  return buckets.map((bucket) => {
    let tokens = 0;
    for (const result of bucket.results ?? []) {
      tokens += result.uncached_input_tokens ?? 0;
      tokens += result.cache_read_input_tokens ?? 0;
      tokens += result.output_tokens ?? 0;
      const cache = result.cache_creation;
      if (cache) {
        tokens += cache.ephemeral_5m_input_tokens ?? 0;
        tokens += cache.ephemeral_1h_input_tokens ?? 0;
      }
    }
    return { date: bucket.starting_at.slice(0, 10), tokens };
  });
}

/** Build daily cost totals from cost buckets. */
export function dailyCostBreakdown(
  buckets: RawCostBucket[]
): { date: string; cost_usd: number }[] {
  return buckets.map((bucket) => {
    let cents = 0;
    for (const result of bucket.results ?? []) {
      cents += parseFloat(result.amount ?? "0");
    }
    return { date: bucket.starting_at.slice(0, 10), cost_usd: centsToUsd(cents) };
  });
}

// ============================================================================
// Claude Code Aggregation (ported from Python _sum_claude_code_tokens)
// ============================================================================

/** Aggregate Claude Code usage from multiple day reports. */
export function aggregateClaudeCode(reports: RawClaudeCodeReport[]): {
  totalTokens: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
  totalCostCents: number;
  perUser: Map<string, { tokens: number; modelsUsed: Set<string> }>;
  daily: Map<string, number>;
} {
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let cacheCreation = 0;
  let totalCostCents = 0;
  const perUser = new Map<
    string,
    { tokens: number; modelsUsed: Set<string> }
  >();
  const daily = new Map<string, number>();

  for (const report of reports) {
    for (const record of report.data ?? []) {
      const email = record.actor?.email_address ?? "unknown";
      let recordTokens = 0;

      for (const mb of record.model_breakdown ?? []) {
        const t = mb.tokens;
        const inp = t?.input ?? 0;
        const out = t?.output ?? 0;
        const cr = t?.cache_read ?? 0;
        const cc = t?.cache_creation ?? 0;

        input += inp;
        output += out;
        cacheRead += cr;
        cacheCreation += cc;
        recordTokens += inp + out + cr + cc;
        totalCostCents += mb.estimated_cost?.amount ?? 0;

        // Per-user tracking
        const user = perUser.get(email) ?? {
          tokens: 0,
          modelsUsed: new Set<string>(),
        };
        user.tokens += inp + out + cr + cc;
        user.modelsUsed.add(mb.model);
        perUser.set(email, user);
      }

      // Daily tracking
      const date = record.date;
      if (date) {
        daily.set(date, (daily.get(date) ?? 0) + recordTokens);
      }
    }
  }

  return {
    totalTokens: input + output + cacheRead + cacheCreation,
    input,
    output,
    cacheRead,
    cacheCreation,
    totalCostCents,
    perUser,
    daily,
  };
}

// ============================================================================
// Capacity Metrics
// ============================================================================

function buildCapacity(
  tokensUsed: number,
  tokenLimit: number,
  daysElapsed: number,
  daysRemaining: number
): CapacityMetrics {
  const tokensRemaining = Math.max(tokenLimit - tokensUsed, 0);
  const usagePct =
    tokenLimit > 0 ? round1((tokensUsed / tokenLimit) * 100) : 0;
  const dailyBurnRate = daysElapsed > 0 ? Math.round(tokensUsed / daysElapsed) : 0;
  const projectedAtEnd = tokensUsed + dailyBurnRate * daysRemaining;

  let daysUntilExhaustion: number | null = null;
  if (dailyBurnRate > 0 && projectedAtEnd > tokenLimit) {
    daysUntilExhaustion = round1(tokensRemaining / dailyBurnRate);
  }

  return {
    tokens_used: tokensUsed,
    token_limit: tokenLimit,
    tokens_remaining: tokensRemaining,
    usage_pct: usagePct,
    daily_burn_rate: dailyBurnRate,
    projected_tokens_at_period_end: Math.round(projectedAtEnd),
    days_until_exhaustion: daysUntilExhaustion,
  };
}

// ============================================================================
// Main Aggregator
// ============================================================================

export interface AggregatorInput {
  org: RawOrganization;
  usageReport: RawUsageReport;
  usageByModel: RawUsageReport;
  costReport: RawCostReport;
  claudeCodeReports: RawClaudeCodeReport[];
  workspaces: RawWorkspacesResponse;
  members: RawMembersResponse;
  apiKeys: RawApiKeysResponse;
  now?: Date;
  claudeApiTokenLimit?: number;
  claudeCodeTokenLimit?: number;
}

export function aggregate(input: AggregatorInput): ClaudeMetricsResponse {
  const now = input.now ?? new Date();
  const billingPeriod = getBillingPeriod(now);
  const claudeApiTokenLimit =
    input.claudeApiTokenLimit ?? DEFAULT_TOKEN_LIMIT;
  const claudeCodeTokenLimit =
    input.claudeCodeTokenLimit ?? DEFAULT_TOKEN_LIMIT;

  // ── Usage ──────────────────────────────────────────────────
  const apiTokens = sumTokensByType(input.usageReport.data ?? []);
  const apiTotalTokens = sumTokens(input.usageReport.data ?? []);

  // ── Cost ───────────────────────────────────────────────────
  const costCents = sumCostCents(input.costReport.data ?? []);
  const currentSpendUsd = centsToUsd(costCents);
  const projectedSpendUsd = projectMonthlyCost(
    currentSpendUsd,
    billingPeriod.days_elapsed,
    billingPeriod.days_total
  );
  const dailyBurnRateUsd =
    billingPeriod.days_elapsed > 0
      ? round2(currentSpendUsd / billingPeriod.days_elapsed)
      : 0;

  // ── Claude Code ────────────────────────────────────────────
  const codeAgg = aggregateClaudeCode(input.claudeCodeReports);
  const hasClaudeCode = codeAgg.totalTokens > 0;

  // ── Capacity ───────────────────────────────────────────────
  const apiCapacity = buildCapacity(
    apiTotalTokens,
    claudeApiTokenLimit,
    billingPeriod.days_elapsed,
    billingPeriod.days_remaining
  );

  const codeCapacity = hasClaudeCode
    ? {
        ...buildCapacity(
          codeAgg.totalTokens,
          claudeCodeTokenLimit,
          billingPeriod.days_elapsed,
          billingPeriod.days_remaining
        ),
        per_user: Array.from(codeAgg.perUser.entries())
          .map(([email, data]) => ({ email, tokens_used: data.tokens }))
          .sort((a, b) => b.tokens_used - a.tokens_used),
      }
    : null;

  // ── Usage breakdown ────────────────────────────────────────
  const apiUsage: UsageBreakdown = {
    input_tokens: apiTokens.input,
    output_tokens: apiTokens.output,
    cache_read_tokens: apiTokens.cache_read,
    cache_creation_tokens: apiTokens.cache_creation,
    by_model: groupUsageByModel(input.usageByModel.data ?? []),
    daily: dailyTokenBreakdown(input.usageReport.data ?? []),
  };

  const codeUsage = hasClaudeCode
    ? {
        input_tokens: codeAgg.input,
        output_tokens: codeAgg.output,
        cache_read_tokens: codeAgg.cacheRead,
        cache_creation_tokens: codeAgg.cacheCreation,
        by_model: [] as { model: string; tokens: number }[],
        daily: Array.from(codeAgg.daily.entries())
          .map(([date, tokens]) => ({ date, tokens }))
          .sort((a, b) => a.date.localeCompare(b.date)),
        per_user: Array.from(codeAgg.perUser.entries())
          .map(([email, data]) => ({
            email,
            tokens: data.tokens,
            models_used: Array.from(data.modelsUsed),
          }))
          .sort((a, b) => b.tokens - a.tokens),
      }
    : null;

  // ── Account ────────────────────────────────────────────────
  const allKeys = input.apiKeys.data ?? [];
  const account: AccountInfo = {
    organization_name: input.org.name ?? "Unknown",
    organization_id: input.org.id ?? "",
    workspaces: (input.workspaces.data ?? []).map((w) => ({
      id: w.id,
      name: w.display_name ?? w.name,
      archived: w.archived_at != null,
    })),
    members: (input.members.data ?? []).map((m) => ({
      id: m.id,
      name: m.name,
      email: m.email,
      role: m.role,
    })),
    api_keys: {
      total: allKeys.length,
      active: allKeys.filter((k) => k.status === "active").length,
      keys: allKeys.map((k) => ({
        id: k.id,
        name: k.name,
        status: k.status,
        workspace_id: k.workspace_id ?? null,
      })),
    },
  };

  // ── Cost metrics ───────────────────────────────────────────
  const cost: CostMetrics = {
    current_spend_usd: currentSpendUsd,
    projected_spend_usd: projectedSpendUsd,
    daily_burn_rate_usd: dailyBurnRateUsd,
    by_model: groupCostByModel(
      input.costReport.data ?? [],
      input.usageByModel.data ?? []
    ),
    daily: dailyCostBreakdown(input.costReport.data ?? []),
  };

  return {
    capacity: {
      claude_api: apiCapacity,
      claude_code: codeCapacity,
    },
    cost,
    usage: {
      claude_api: apiUsage,
      claude_code: codeUsage,
    },
    account,
    billing_period: billingPeriod,
    meta: {
      fetched_at: now.toISOString(),
      api_version: "2023-06-01",
    },
  };
}

// ============================================================================
// Helpers
// ============================================================================

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
