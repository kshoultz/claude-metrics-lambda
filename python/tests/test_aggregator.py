"""
Unit tests for the aggregator module — mirrors the TypeScript Vitest tests
with identical mock data and expected values.
"""

from datetime import datetime, timezone

import pytest

from src.aggregator import (
    aggregate,
    aggregate_claude_code,
    cents_to_usd,
    daily_cost_breakdown,
    daily_token_breakdown,
    get_billing_period,
    get_date_range,
    group_usage_by_model,
    project_monthly_cost,
    sum_cost_cents,
    sum_tokens,
    sum_tokens_by_type,
)


# ============================================================================
# Token Summation
# ============================================================================


class TestSumTokens:
    def test_sums_all_token_types_across_buckets(self):
        buckets = [
            {
                "bucket_start_time": "2026-03-01T00:00:00Z",
                "results": [
                    {
                        "uncached_input_tokens": 1000,
                        "cache_read_input_tokens": 200,
                        "output_tokens": 500,
                        "cache_creation": {
                            "ephemeral_5m_input_tokens": 50,
                            "ephemeral_1h_input_tokens": 30,
                        },
                    },
                ],
            },
            {
                "bucket_start_time": "2026-03-02T00:00:00Z",
                "results": [
                    {
                        "uncached_input_tokens": 2000,
                        "cache_read_input_tokens": 100,
                        "output_tokens": 800,
                    },
                ],
            },
        ]

        assert sum_tokens(buckets) == 1000 + 200 + 500 + 50 + 30 + 2000 + 100 + 800

    def test_returns_zero_for_empty_buckets(self):
        assert sum_tokens([]) == 0

    def test_handles_missing_cache_creation_fields(self):
        buckets = [
            {
                "bucket_start_time": "2026-03-01T00:00:00Z",
                "results": [
                    {
                        "uncached_input_tokens": 100,
                        "cache_read_input_tokens": 0,
                        "output_tokens": 50,
                    },
                ],
            },
        ]
        assert sum_tokens(buckets) == 150


class TestSumTokensByType:
    def test_breaks_down_tokens_by_type(self):
        buckets = [
            {
                "bucket_start_time": "2026-03-01T00:00:00Z",
                "results": [
                    {
                        "uncached_input_tokens": 1000,
                        "cache_read_input_tokens": 200,
                        "output_tokens": 500,
                        "cache_creation": {
                            "ephemeral_5m_input_tokens": 50,
                            "ephemeral_1h_input_tokens": 30,
                        },
                    },
                ],
            },
        ]

        result = sum_tokens_by_type(buckets)
        assert result["input"] == 1000
        assert result["output"] == 500
        assert result["cache_read"] == 200
        assert result["cache_creation"] == 80


# ============================================================================
# Cost Summation
# ============================================================================


class TestSumCostCents:
    def test_sums_cost_amounts_in_cents(self):
        buckets = [
            {
                "bucket_start_time": "2026-03-01T00:00:00Z",
                "results": [{"amount": "150"}, {"amount": "250"}],
            },
            {
                "bucket_start_time": "2026-03-02T00:00:00Z",
                "results": [{"amount": "1000"}],
            },
        ]

        assert sum_cost_cents(buckets) == 1400

    def test_returns_zero_for_empty_buckets(self):
        assert sum_cost_cents([]) == 0


class TestCentsToUsd:
    def test_converts_cents_to_usd_with_2_decimal_places(self):
        assert cents_to_usd(1400) == 14.0
        assert cents_to_usd(1234) == 12.34
        assert cents_to_usd(1) == 0.01
        assert cents_to_usd(0) == 0


# ============================================================================
# Cost Projection
# ============================================================================


class TestProjectMonthlyCost:
    def test_projects_monthly_cost_via_linear_extrapolation(self):
        # $10 spent over 10 days in a 30-day month = $30 projected
        assert project_monthly_cost(10, 10, 30) == 30

    def test_returns_current_cost_if_no_days_elapsed(self):
        assert project_monthly_cost(5, 0, 30) == 5

    def test_handles_fractional_days(self):
        # $15 over 15.5 days in 31-day month ~ $30
        result = project_monthly_cost(15, 15.5, 31)
        assert abs(result - 30) < 1


# ============================================================================
# Billing Period
# ============================================================================


class TestGetBillingPeriod:
    def test_returns_period_starting_on_first_of_month(self):
        now = datetime(2026, 3, 15, 12, 0, 0, tzinfo=timezone.utc)
        period = get_billing_period(now)

        assert period["start"] == "2026-03-01T00:00:00.000Z"
        assert period["end"] == "2026-04-01T00:00:00.000Z"
        assert period["days_total"] == 31
        assert period["days_elapsed"] > 14
        assert period["days_remaining"] < 17
        assert period["resets_at"] == "2026-04-01T00:00:00.000Z"


class TestGetDateRange:
    def test_generates_yyyy_mm_dd_strings_from_start_to_now(self):
        start = datetime(2026, 3, 1, 0, 0, 0, tzinfo=timezone.utc)
        now = datetime(2026, 3, 3, 15, 0, 0, tzinfo=timezone.utc)
        dates = get_date_range(start, now)

        assert dates == ["2026-03-01", "2026-03-02", "2026-03-03"]


# ============================================================================
# Daily Breakdowns
# ============================================================================


class TestDailyTokenBreakdown:
    def test_produces_date_token_pairs_from_buckets(self):
        buckets = [
            {
                "bucket_start_time": "2026-03-01T00:00:00Z",
                "results": [
                    {"uncached_input_tokens": 100, "cache_read_input_tokens": 0, "output_tokens": 50},
                ],
            },
            {
                "bucket_start_time": "2026-03-02T00:00:00Z",
                "results": [
                    {"uncached_input_tokens": 200, "cache_read_input_tokens": 0, "output_tokens": 100},
                ],
            },
        ]

        result = daily_token_breakdown(buckets)
        assert result == [
            {"date": "2026-03-01", "tokens": 150},
            {"date": "2026-03-02", "tokens": 300},
        ]


class TestDailyCostBreakdown:
    def test_produces_date_cost_pairs_from_buckets(self):
        buckets = [
            {"bucket_start_time": "2026-03-01T00:00:00Z", "results": [{"amount": "500"}]},
            {"bucket_start_time": "2026-03-02T00:00:00Z", "results": [{"amount": "750"}]},
        ]

        result = daily_cost_breakdown(buckets)
        assert result == [
            {"date": "2026-03-01", "cost_usd": 5.0},
            {"date": "2026-03-02", "cost_usd": 7.5},
        ]


# ============================================================================
# Model Grouping
# ============================================================================


class TestGroupUsageByModel:
    def test_groups_and_sums_tokens_by_model_sorted_descending(self):
        buckets = [
            {
                "bucket_start_time": "2026-03-01T00:00:00Z",
                "results": [
                    {
                        "uncached_input_tokens": 1000,
                        "cache_read_input_tokens": 0,
                        "output_tokens": 500,
                        "model": "claude-opus-4-20250514",
                    },
                    {
                        "uncached_input_tokens": 5000,
                        "cache_read_input_tokens": 0,
                        "output_tokens": 2000,
                        "model": "claude-sonnet-4-20250514",
                    },
                ],
            },
        ]

        result = group_usage_by_model(buckets)
        assert result[0]["model"] == "claude-sonnet-4-20250514"
        assert result[0]["tokens"] == 7000
        assert result[1]["model"] == "claude-opus-4-20250514"
        assert result[1]["tokens"] == 1500


# ============================================================================
# Claude Code Aggregation
# ============================================================================


class TestAggregateClaudeCode:
    def test_sums_tokens_and_groups_by_user(self):
        reports = [
            {
                "data": [
                    {
                        "date": "2026-03-01",
                        "actor": {"type": "user", "email_address": "dev@example.com"},
                        "model_breakdown": [
                            {
                                "model": "claude-sonnet-4-20250514",
                                "tokens": {"input": 1000, "output": 500, "cache_read": 200, "cache_creation": 50},
                                "estimated_cost": {"amount": 150, "currency": "usd"},
                            },
                        ],
                    },
                    {
                        "date": "2026-03-01",
                        "actor": {"type": "user", "email_address": "other@example.com"},
                        "model_breakdown": [
                            {
                                "model": "claude-haiku-3-5-20241022",
                                "tokens": {"input": 500, "output": 200, "cache_read": 0, "cache_creation": 0},
                                "estimated_cost": {"amount": 10, "currency": "usd"},
                            },
                        ],
                    },
                ],
                "has_more": False,
            },
        ]

        result = aggregate_claude_code(reports)
        assert result["total_tokens"] == 1000 + 500 + 200 + 50 + 500 + 200
        assert result["input"] == 1500
        assert result["output"] == 700
        assert result["total_cost_cents"] == 160
        assert len(result["per_user"]) == 2
        assert result["per_user"]["dev@example.com"]["tokens"] == 1750
        assert result["per_user"]["other@example.com"]["tokens"] == 700

    def test_returns_zeros_for_empty_reports(self):
        result = aggregate_claude_code([])
        assert result["total_tokens"] == 0
        assert len(result["per_user"]) == 0


# ============================================================================
# Full Aggregation
# ============================================================================


class TestAggregate:
    def test_produces_a_complete_claude_metrics_response(self):
        now = datetime(2026, 3, 15, 12, 0, 0, tzinfo=timezone.utc)

        result = aggregate({
            "org": {"id": "org-123", "name": "Test Org"},
            "usage_report": {
                "data": [
                    {
                        "bucket_start_time": "2026-03-01T00:00:00Z",
                        "results": [
                            {"uncached_input_tokens": 10000, "cache_read_input_tokens": 500, "output_tokens": 5000},
                        ],
                    },
                ],
                "has_more": False,
            },
            "usage_by_model": {
                "data": [
                    {
                        "bucket_start_time": "2026-03-01T00:00:00Z",
                        "results": [
                            {
                                "uncached_input_tokens": 10000,
                                "cache_read_input_tokens": 500,
                                "output_tokens": 5000,
                                "model": "claude-sonnet-4-20250514",
                            },
                        ],
                    },
                ],
                "has_more": False,
            },
            "cost_report": {
                "data": [
                    {
                        "bucket_start_time": "2026-03-01T00:00:00Z",
                        "results": [{"amount": "500"}],
                    },
                ],
                "has_more": False,
            },
            "claude_code_reports": [],
            "workspaces": {
                "data": [{"id": "ws-1", "name": "default", "created_at": "2026-01-01T00:00:00Z"}],
                "has_more": False,
            },
            "members": {
                "data": [{"id": "u-1", "name": "Kevin", "email": "kevin@test.com", "role": "admin", "created_at": "2026-01-01T00:00:00Z"}],
                "has_more": False,
            },
            "api_keys": {
                "data": [{"id": "key-1", "name": "main", "status": "active", "created_at": "2026-01-01T00:00:00Z"}],
                "has_more": False,
            },
            "now": now,
        })

        # Capacity
        assert result["capacity"]["claude_api"]["tokens_used"] == 15500
        assert result["capacity"]["claude_api"]["token_limit"] == 50_000_000
        assert result["capacity"]["claude_code"] is None

        # Cost
        assert result["cost"]["current_spend_usd"] == 5.0
        assert result["cost"]["projected_spend_usd"] > 5.0
        assert len(result["cost"]["daily"]) == 1

        # Usage
        assert result["usage"]["claude_api"]["input_tokens"] == 10000
        assert result["usage"]["claude_api"]["output_tokens"] == 5000
        assert result["usage"]["claude_code"] is None

        # Account
        assert result["account"]["organization_name"] == "Test Org"
        assert len(result["account"]["members"]) == 1
        assert result["account"]["api_keys"]["active"] == 1

        # Billing
        assert result["billing_period"]["days_total"] == 31

        # Meta
        assert result["meta"]["fetched_at"] == "2026-03-15T12:00:00.000Z"
