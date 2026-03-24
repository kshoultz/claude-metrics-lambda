import { describe, it, expect } from "vitest";
import {
  sumTokens,
  sumTokensByType,
  sumCostCents,
  centsToUsd,
  projectMonthlyCost,
  getBillingPeriod,
  getDateRange,
  dailyTokenBreakdown,
  dailyCostBreakdown,
  groupUsageByModel,
  aggregateClaudeCode,
  aggregate,
} from "../src/aggregator.js";
import type {
  RawUsageBucket,
  RawCostBucket,
  RawClaudeCodeReport,
} from "../src/types.js";

// ============================================================================
// Token Summation
// ============================================================================

describe("sumTokens", () => {
  it("sums all token types across buckets", () => {
    const buckets: RawUsageBucket[] = [
      {
        bucket_start_time: "2026-03-01T00:00:00Z",
        results: [
          {
            uncached_input_tokens: 1000,
            cache_read_input_tokens: 200,
            output_tokens: 500,
            cache_creation: {
              ephemeral_5m_input_tokens: 50,
              ephemeral_1h_input_tokens: 30,
            },
          },
        ],
      },
      {
        bucket_start_time: "2026-03-02T00:00:00Z",
        results: [
          {
            uncached_input_tokens: 2000,
            cache_read_input_tokens: 100,
            output_tokens: 800,
          },
        ],
      },
    ];

    expect(sumTokens(buckets)).toBe(1000 + 200 + 500 + 50 + 30 + 2000 + 100 + 800);
  });

  it("returns 0 for empty buckets", () => {
    expect(sumTokens([])).toBe(0);
  });

  it("handles missing cache_creation fields", () => {
    const buckets: RawUsageBucket[] = [
      {
        bucket_start_time: "2026-03-01T00:00:00Z",
        results: [
          {
            uncached_input_tokens: 100,
            cache_read_input_tokens: 0,
            output_tokens: 50,
          },
        ],
      },
    ];
    expect(sumTokens(buckets)).toBe(150);
  });
});

describe("sumTokensByType", () => {
  it("breaks down tokens by type", () => {
    const buckets: RawUsageBucket[] = [
      {
        bucket_start_time: "2026-03-01T00:00:00Z",
        results: [
          {
            uncached_input_tokens: 1000,
            cache_read_input_tokens: 200,
            output_tokens: 500,
            cache_creation: {
              ephemeral_5m_input_tokens: 50,
              ephemeral_1h_input_tokens: 30,
            },
          },
        ],
      },
    ];

    const result = sumTokensByType(buckets);
    expect(result.input).toBe(1000);
    expect(result.output).toBe(500);
    expect(result.cache_read).toBe(200);
    expect(result.cache_creation).toBe(80);
  });
});

// ============================================================================
// Cost Summation
// ============================================================================

describe("sumCostCents", () => {
  it("sums cost amounts in cents", () => {
    const buckets: RawCostBucket[] = [
      {
        bucket_start_time: "2026-03-01T00:00:00Z",
        results: [{ amount: "150" }, { amount: "250" }],
      },
      {
        bucket_start_time: "2026-03-02T00:00:00Z",
        results: [{ amount: "1000" }],
      },
    ];

    expect(sumCostCents(buckets)).toBe(1400);
  });

  it("returns 0 for empty buckets", () => {
    expect(sumCostCents([])).toBe(0);
  });
});

describe("centsToUsd", () => {
  it("converts cents to USD with 2 decimal places", () => {
    expect(centsToUsd(1400)).toBe(14.0);
    expect(centsToUsd(1234)).toBe(12.34);
    expect(centsToUsd(1)).toBe(0.01);
    expect(centsToUsd(0)).toBe(0);
  });
});

// ============================================================================
// Cost Projection
// ============================================================================

describe("projectMonthlyCost", () => {
  it("projects monthly cost via linear extrapolation", () => {
    // $10 spent over 10 days in a 30-day month = $30 projected
    expect(projectMonthlyCost(10, 10, 30)).toBe(30);
  });

  it("returns current cost if no days elapsed", () => {
    expect(projectMonthlyCost(5, 0, 30)).toBe(5);
  });

  it("handles fractional days", () => {
    // $15 over 15.5 days in 31-day month ≈ $30
    const result = projectMonthlyCost(15, 15.5, 31);
    expect(result).toBeCloseTo(30, 0);
  });
});

// ============================================================================
// Billing Period
// ============================================================================

describe("getBillingPeriod", () => {
  it("returns period starting on the 1st of the month", () => {
    const now = new Date("2026-03-15T12:00:00Z");
    const period = getBillingPeriod(now);

    expect(period.start).toBe("2026-03-01T00:00:00.000Z");
    expect(period.end).toBe("2026-04-01T00:00:00.000Z");
    expect(period.days_total).toBe(31);
    expect(period.days_elapsed).toBeGreaterThan(14);
    expect(period.days_remaining).toBeLessThan(17);
    expect(period.resets_at).toBe("2026-04-01T00:00:00.000Z");
  });
});

describe("getDateRange", () => {
  it("generates YYYY-MM-DD strings from start to now", () => {
    const start = new Date("2026-03-01T00:00:00Z");
    const now = new Date("2026-03-03T15:00:00Z");
    const dates = getDateRange(start, now);

    expect(dates).toEqual(["2026-03-01", "2026-03-02", "2026-03-03"]);
  });
});

// ============================================================================
// Daily Breakdowns
// ============================================================================

describe("dailyTokenBreakdown", () => {
  it("produces date/token pairs from buckets", () => {
    const buckets: RawUsageBucket[] = [
      {
        bucket_start_time: "2026-03-01T00:00:00Z",
        results: [
          { uncached_input_tokens: 100, cache_read_input_tokens: 0, output_tokens: 50 },
        ],
      },
      {
        bucket_start_time: "2026-03-02T00:00:00Z",
        results: [
          { uncached_input_tokens: 200, cache_read_input_tokens: 0, output_tokens: 100 },
        ],
      },
    ];

    const result = dailyTokenBreakdown(buckets);
    expect(result).toEqual([
      { date: "2026-03-01", tokens: 150 },
      { date: "2026-03-02", tokens: 300 },
    ]);
  });
});

describe("dailyCostBreakdown", () => {
  it("produces date/cost pairs from buckets", () => {
    const buckets: RawCostBucket[] = [
      { bucket_start_time: "2026-03-01T00:00:00Z", results: [{ amount: "500" }] },
      { bucket_start_time: "2026-03-02T00:00:00Z", results: [{ amount: "750" }] },
    ];

    const result = dailyCostBreakdown(buckets);
    expect(result).toEqual([
      { date: "2026-03-01", cost_usd: 5.0 },
      { date: "2026-03-02", cost_usd: 7.5 },
    ]);
  });
});

// ============================================================================
// Model Grouping
// ============================================================================

describe("groupUsageByModel", () => {
  it("groups and sums tokens by model, sorted descending", () => {
    const buckets: RawUsageBucket[] = [
      {
        bucket_start_time: "2026-03-01T00:00:00Z",
        results: [
          { uncached_input_tokens: 1000, cache_read_input_tokens: 0, output_tokens: 500, model: "claude-opus-4-20250514" },
          { uncached_input_tokens: 5000, cache_read_input_tokens: 0, output_tokens: 2000, model: "claude-sonnet-4-20250514" },
        ],
      },
    ];

    const result = groupUsageByModel(buckets);
    expect(result[0].model).toBe("claude-sonnet-4-20250514");
    expect(result[0].tokens).toBe(7000);
    expect(result[1].model).toBe("claude-opus-4-20250514");
    expect(result[1].tokens).toBe(1500);
  });
});

// ============================================================================
// Claude Code Aggregation
// ============================================================================

describe("aggregateClaudeCode", () => {
  it("sums tokens and groups by user", () => {
    const reports: RawClaudeCodeReport[] = [
      {
        data: [
          {
            date: "2026-03-01",
            actor: { type: "user", email_address: "dev@example.com" },
            model_breakdown: [
              {
                model: "claude-sonnet-4-20250514",
                tokens: { input: 1000, output: 500, cache_read: 200, cache_creation: 50 },
                estimated_cost: { amount: 150, currency: "usd" },
              },
            ],
          },
          {
            date: "2026-03-01",
            actor: { type: "user", email_address: "other@example.com" },
            model_breakdown: [
              {
                model: "claude-haiku-3-5-20241022",
                tokens: { input: 500, output: 200, cache_read: 0, cache_creation: 0 },
                estimated_cost: { amount: 10, currency: "usd" },
              },
            ],
          },
        ],
        has_more: false,
      },
    ];

    const result = aggregateClaudeCode(reports);
    expect(result.totalTokens).toBe(1000 + 500 + 200 + 50 + 500 + 200);
    expect(result.input).toBe(1500);
    expect(result.output).toBe(700);
    expect(result.totalCostCents).toBe(160);
    expect(result.perUser.size).toBe(2);
    expect(result.perUser.get("dev@example.com")?.tokens).toBe(1750);
    expect(result.perUser.get("other@example.com")?.tokens).toBe(700);
  });

  it("returns zeros for empty reports", () => {
    const result = aggregateClaudeCode([]);
    expect(result.totalTokens).toBe(0);
    expect(result.perUser.size).toBe(0);
  });
});

// ============================================================================
// Full Aggregation
// ============================================================================

describe("aggregate", () => {
  it("produces a complete ClaudeMetricsResponse", () => {
    const now = new Date("2026-03-15T12:00:00Z");

    const result = aggregate({
      org: { id: "org-123", name: "Test Org" },
      usageReport: {
        data: [
          {
            bucket_start_time: "2026-03-01T00:00:00Z",
            results: [
              { uncached_input_tokens: 10000, cache_read_input_tokens: 500, output_tokens: 5000 },
            ],
          },
        ],
        has_more: false,
      },
      usageByModel: {
        data: [
          {
            bucket_start_time: "2026-03-01T00:00:00Z",
            results: [
              { uncached_input_tokens: 10000, cache_read_input_tokens: 500, output_tokens: 5000, model: "claude-sonnet-4-20250514" },
            ],
          },
        ],
        has_more: false,
      },
      costReport: {
        data: [
          {
            bucket_start_time: "2026-03-01T00:00:00Z",
            results: [{ amount: "500" }],
          },
        ],
        has_more: false,
      },
      claudeCodeReports: [],
      workspaces: { data: [{ id: "ws-1", name: "default", created_at: "2026-01-01T00:00:00Z" }], has_more: false },
      members: { data: [{ id: "u-1", name: "Kevin", email: "kevin@test.com", role: "admin", created_at: "2026-01-01T00:00:00Z" }], has_more: false },
      apiKeys: { data: [{ id: "key-1", name: "main", status: "active", created_at: "2026-01-01T00:00:00Z" }], has_more: false },
      now,
    });

    // Capacity
    expect(result.capacity.claude_api.tokens_used).toBe(15500);
    expect(result.capacity.claude_api.token_limit).toBe(50_000_000);
    expect(result.capacity.claude_code).toBeNull();

    // Cost
    expect(result.cost.current_spend_usd).toBe(5.0);
    expect(result.cost.projected_spend_usd).toBeGreaterThan(5.0);
    expect(result.cost.daily.length).toBe(1);

    // Usage
    expect(result.usage.claude_api.input_tokens).toBe(10000);
    expect(result.usage.claude_api.output_tokens).toBe(5000);
    expect(result.usage.claude_code).toBeNull();

    // Account
    expect(result.account.organization_name).toBe("Test Org");
    expect(result.account.members.length).toBe(1);
    expect(result.account.api_keys.active).toBe(1);

    // Billing
    expect(result.billing_period.days_total).toBe(31);

    // Meta
    expect(result.meta.fetched_at).toBe(now.toISOString());
  });
});
