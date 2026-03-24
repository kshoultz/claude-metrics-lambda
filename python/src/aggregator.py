"""
Aggregator — shapes raw Anthropic Admin API responses into ClaudeMetricsResponse.

Ports proven math from the TypeScript aggregator:
- Token summation across daily buckets
- Cost aggregation (cents -> USD)
- Monthly cost projection (linear extrapolation)

Adds: burn rate, exhaustion projection, by-model grouping, per-user breakdown.
"""

from __future__ import annotations

import math
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

DEFAULT_TOKEN_LIMIT = 50_000_000  # 50M tokens


# ============================================================================
# Helpers — rounding must match JavaScript Math.round (round-half-up)
# ============================================================================

def round1(n: float) -> float:
    """Round to 1 decimal place (JS Math.round semantics)."""
    return math.floor(n * 10 + 0.5) / 10


def round2(n: float) -> float:
    """Round to 2 decimal places (JS Math.round semantics)."""
    return math.floor(n * 100 + 0.5) / 100


def _format_iso_utc(dt: datetime) -> str:
    """Format datetime to JS-compatible ISO string: YYYY-MM-DDTHH:MM:SS.mmmZ."""
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


# ============================================================================
# Billing Period
# ============================================================================

def get_billing_period(now: Optional[datetime] = None) -> dict[str, Any]:
    if now is None:
        now = datetime.now(timezone.utc)

    start = datetime(now.year, now.month, 1, tzinfo=timezone.utc)

    if now.month == 12:
        end_of_month = datetime(now.year + 1, 1, 1, tzinfo=timezone.utc)
    else:
        end_of_month = datetime(now.year, now.month + 1, 1, tzinfo=timezone.utc)

    days_total = round((end_of_month - start).total_seconds() / 86400)
    days_elapsed = max((now - start).total_seconds() / 86400, 0.0)
    days_remaining = max(days_total - days_elapsed, 0.0)

    return {
        "start": _format_iso_utc(start),
        "end": _format_iso_utc(end_of_month),
        "days_total": days_total,
        "days_elapsed": round2(days_elapsed),
        "days_remaining": round2(days_remaining),
        "resets_at": _format_iso_utc(end_of_month),
    }


def get_date_range(period_start: datetime, now: datetime) -> list[str]:
    """Build list of YYYY-MM-DD date strings from period start to now."""
    dates: list[str] = []
    current = datetime(
        period_start.year, period_start.month, period_start.day,
        tzinfo=timezone.utc,
    )
    while current <= now:
        dates.append(current.strftime("%Y-%m-%d"))
        current += timedelta(days=1)
    return dates


# ============================================================================
# Token Summation (ported from TS sumTokens / sumTokensByType)
# ============================================================================

def _result_cache_tokens(result: dict) -> int:
    cache = result.get("cache_creation")
    if not cache:
        return 0
    return (cache.get("ephemeral_5m_input_tokens") or 0) + (cache.get("ephemeral_1h_input_tokens") or 0)


def sum_tokens(buckets: list[dict]) -> int:
    total = 0
    for bucket in buckets:
        for result in bucket.get("results") or []:
            total += result.get("uncached_input_tokens") or 0
            total += result.get("cache_read_input_tokens") or 0
            total += result.get("output_tokens") or 0
            total += _result_cache_tokens(result)
    return total


def sum_tokens_by_type(buckets: list[dict]) -> dict[str, int]:
    """Sum tokens broken down by type for the usage breakdown section."""
    inp = 0
    output = 0
    cache_read = 0
    cache_creation = 0

    for bucket in buckets:
        for result in bucket.get("results") or []:
            inp += result.get("uncached_input_tokens") or 0
            output += result.get("output_tokens") or 0
            cache_read += result.get("cache_read_input_tokens") or 0
            cache_creation += _result_cache_tokens(result)

    return {
        "input": inp,
        "output": output,
        "cache_read": cache_read,
        "cache_creation": cache_creation,
    }


# ============================================================================
# Cost Summation (ported from TS sumCostCents / centsToUsd)
# ============================================================================

def sum_cost_cents(buckets: list[dict]) -> float:
    """Sum cost across buckets. Amounts are in cents as decimal strings."""
    total_cents = 0.0
    for bucket in buckets:
        for result in bucket.get("results") or []:
            total_cents += float(result.get("amount") or "0")
    return total_cents


def cents_to_usd(cents: float) -> float:
    """Convert cents to USD, rounded to 2 decimal places."""
    return round2(cents / 100)


# ============================================================================
# Cost Projection (ported from TS projectMonthlyCost)
# ============================================================================

def project_monthly_cost(
    current_cost_usd: float,
    days_elapsed: float,
    days_total: int,
) -> float:
    """Project monthly cost based on linear extrapolation of spend-to-date."""
    if days_elapsed <= 0:
        return current_cost_usd
    daily_rate = current_cost_usd / days_elapsed
    return round2(daily_rate * days_total)


# ============================================================================
# By-Model Grouping
# ============================================================================

def _result_total_tokens(result: dict) -> int:
    return (
        (result.get("uncached_input_tokens") or 0)
        + (result.get("cache_read_input_tokens") or 0)
        + (result.get("output_tokens") or 0)
        + _result_cache_tokens(result)
    )


def group_usage_by_model(buckets: list[dict]) -> list[dict]:
    """Group usage buckets by model, summing tokens per model."""
    model_map: dict[str, int] = defaultdict(int)
    for bucket in buckets:
        for result in bucket.get("results") or []:
            model = result.get("model") or "unknown"
            model_map[model] += _result_total_tokens(result)
    return sorted(
        [{"model": m, "tokens": t} for m, t in model_map.items()],
        key=lambda x: x["tokens"],
        reverse=True,
    )


def group_cost_by_model(
    buckets: list[dict],
    usage_buckets: list[dict],
) -> list[dict]:
    """Group cost buckets by model, summing cost per model."""
    cost_map: dict[str, float] = defaultdict(float)
    for bucket in buckets:
        for result in bucket.get("results") or []:
            model = result.get("model") or "unknown"
            cents = float(result.get("amount") or "0")
            cost_map[model] += cents

    token_by_model = {m["model"]: m["tokens"] for m in group_usage_by_model(usage_buckets)}

    return sorted(
        [
            {
                "model": m,
                "cost_usd": cents_to_usd(c),
                "tokens_used": token_by_model.get(m, 0),
            }
            for m, c in cost_map.items()
        ],
        key=lambda x: x["cost_usd"],
        reverse=True,
    )


# ============================================================================
# Daily Breakdown
# ============================================================================

def daily_token_breakdown(buckets: list[dict]) -> list[dict]:
    """Build daily token totals from usage buckets."""
    result = []
    for bucket in buckets:
        tokens = 0
        for r in bucket.get("results") or []:
            tokens += (r.get("uncached_input_tokens") or 0)
            tokens += (r.get("cache_read_input_tokens") or 0)
            tokens += (r.get("output_tokens") or 0)
            tokens += _result_cache_tokens(r)
        result.append({
            "date": bucket["bucket_start_time"][:10],
            "tokens": tokens,
        })
    return result


def daily_cost_breakdown(buckets: list[dict]) -> list[dict]:
    """Build daily cost totals from cost buckets."""
    result = []
    for bucket in buckets:
        cents = 0.0
        for r in bucket.get("results") or []:
            cents += float(r.get("amount") or "0")
        result.append({
            "date": bucket["bucket_start_time"][:10],
            "cost_usd": cents_to_usd(cents),
        })
    return result


# ============================================================================
# Claude Code Aggregation (ported from TS aggregateClaudeCode)
# ============================================================================

def aggregate_claude_code(reports: list[dict]) -> dict:
    """Aggregate Claude Code usage from multiple day reports."""
    inp = 0
    output = 0
    cache_read = 0
    cache_creation = 0
    total_cost_cents = 0.0
    per_user: dict[str, dict] = {}
    daily: dict[str, int] = defaultdict(int)

    for report in reports:
        for record in report.get("data") or []:
            email = (record.get("actor") or {}).get("email_address") or "unknown"
            record_tokens = 0

            for mb in record.get("model_breakdown") or []:
                t = mb.get("tokens") or {}
                i = t.get("input") or 0
                o = t.get("output") or 0
                cr = t.get("cache_read") or 0
                cc = t.get("cache_creation") or 0

                inp += i
                output += o
                cache_read += cr
                cache_creation += cc
                record_tokens += i + o + cr + cc
                total_cost_cents += (mb.get("estimated_cost") or {}).get("amount") or 0

                # Per-user tracking
                if email not in per_user:
                    per_user[email] = {"tokens": 0, "models_used": set()}
                per_user[email]["tokens"] += i + o + cr + cc
                per_user[email]["models_used"].add(mb["model"])

            # Daily tracking
            date = record.get("date")
            if date:
                daily[date] += record_tokens

    return {
        "total_tokens": inp + output + cache_read + cache_creation,
        "input": inp,
        "output": output,
        "cache_read": cache_read,
        "cache_creation": cache_creation,
        "total_cost_cents": total_cost_cents,
        "per_user": per_user,
        "daily": dict(daily),
    }


# ============================================================================
# Capacity Metrics
# ============================================================================

def _build_capacity(
    tokens_used: int,
    token_limit: int,
    days_elapsed: float,
    days_remaining: float,
) -> dict:
    tokens_remaining = max(token_limit - tokens_used, 0)
    usage_pct = round1((tokens_used / token_limit) * 100) if token_limit > 0 else 0.0
    daily_burn_rate = round(tokens_used / days_elapsed) if days_elapsed > 0 else 0
    projected_at_end = tokens_used + daily_burn_rate * days_remaining

    days_until_exhaustion: Optional[float] = None
    if daily_burn_rate > 0 and projected_at_end > token_limit:
        days_until_exhaustion = round1(tokens_remaining / daily_burn_rate)

    return {
        "tokens_used": tokens_used,
        "token_limit": token_limit,
        "tokens_remaining": tokens_remaining,
        "usage_pct": usage_pct,
        "daily_burn_rate": daily_burn_rate,
        "projected_tokens_at_period_end": round(projected_at_end),
        "days_until_exhaustion": days_until_exhaustion,
    }


# ============================================================================
# Main Aggregator
# ============================================================================

def aggregate(input_data: dict) -> dict:
    now: datetime = input_data.get("now") or datetime.now(timezone.utc)
    billing_period = get_billing_period(now)
    claude_api_token_limit = input_data.get("claude_api_token_limit") or DEFAULT_TOKEN_LIMIT
    claude_code_token_limit = input_data.get("claude_code_token_limit") or DEFAULT_TOKEN_LIMIT

    # -- Usage --
    usage_data = (input_data["usage_report"].get("data") or [])
    api_tokens = sum_tokens_by_type(usage_data)
    api_total_tokens = sum_tokens(usage_data)

    # -- Cost --
    cost_data = (input_data["cost_report"].get("data") or [])
    cost_cents = sum_cost_cents(cost_data)
    current_spend_usd = cents_to_usd(cost_cents)
    projected_spend_usd = project_monthly_cost(
        current_spend_usd,
        billing_period["days_elapsed"],
        billing_period["days_total"],
    )
    daily_burn_rate_usd = (
        round2(current_spend_usd / billing_period["days_elapsed"])
        if billing_period["days_elapsed"] > 0
        else 0.0
    )

    # -- Claude Code --
    code_agg = aggregate_claude_code(input_data.get("claude_code_reports") or [])
    has_claude_code = code_agg["total_tokens"] > 0

    # -- Capacity --
    api_capacity = _build_capacity(
        api_total_tokens,
        claude_api_token_limit,
        billing_period["days_elapsed"],
        billing_period["days_remaining"],
    )

    code_capacity = None
    if has_claude_code:
        code_capacity = _build_capacity(
            code_agg["total_tokens"],
            claude_code_token_limit,
            billing_period["days_elapsed"],
            billing_period["days_remaining"],
        )
        code_capacity["per_user"] = sorted(
            [
                {"email": email, "tokens_used": data["tokens"]}
                for email, data in code_agg["per_user"].items()
            ],
            key=lambda x: x["tokens_used"],
            reverse=True,
        )

    # -- Usage breakdown --
    usage_by_model_data = (input_data["usage_by_model"].get("data") or [])
    api_usage = {
        "input_tokens": api_tokens["input"],
        "output_tokens": api_tokens["output"],
        "cache_read_tokens": api_tokens["cache_read"],
        "cache_creation_tokens": api_tokens["cache_creation"],
        "by_model": group_usage_by_model(usage_by_model_data),
        "daily": daily_token_breakdown(usage_data),
    }

    code_usage = None
    if has_claude_code:
        code_usage = {
            "input_tokens": code_agg["input"],
            "output_tokens": code_agg["output"],
            "cache_read_tokens": code_agg["cache_read"],
            "cache_creation_tokens": code_agg["cache_creation"],
            "by_model": [],
            "daily": sorted(
                [{"date": d, "tokens": t} for d, t in code_agg["daily"].items()],
                key=lambda x: x["date"],
            ),
            "per_user": sorted(
                [
                    {
                        "email": email,
                        "tokens": data["tokens"],
                        "models_used": list(data["models_used"]),
                    }
                    for email, data in code_agg["per_user"].items()
                ],
                key=lambda x: x["tokens"],
                reverse=True,
            ),
        }

    # -- Account --
    all_keys = input_data["api_keys"].get("data") or []
    account = {
        "organization_name": input_data["org"].get("name") or "Unknown",
        "organization_id": input_data["org"].get("id") or "",
        "workspaces": [
            {
                "id": w["id"],
                "name": w.get("display_name") or w["name"],
                "archived": w.get("archived_at") is not None,
            }
            for w in (input_data["workspaces"].get("data") or [])
        ],
        "members": [
            {
                "id": m["id"],
                "name": m["name"],
                "email": m["email"],
                "role": m["role"],
            }
            for m in (input_data["members"].get("data") or [])
        ],
        "api_keys": {
            "total": len(all_keys),
            "active": sum(1 for k in all_keys if k.get("status") == "active"),
            "keys": [
                {
                    "id": k["id"],
                    "name": k["name"],
                    "status": k["status"],
                    "workspace_id": k.get("workspace_id"),
                }
                for k in all_keys
            ],
        },
    }

    # -- Cost metrics --
    cost = {
        "current_spend_usd": current_spend_usd,
        "projected_spend_usd": projected_spend_usd,
        "daily_burn_rate_usd": daily_burn_rate_usd,
        "by_model": group_cost_by_model(cost_data, usage_by_model_data),
        "daily": daily_cost_breakdown(cost_data),
    }

    return {
        "capacity": {
            "claude_api": api_capacity,
            "claude_code": code_capacity,
        },
        "cost": cost,
        "usage": {
            "claude_api": api_usage,
            "claude_code": code_usage,
        },
        "account": account,
        "billing_period": billing_period,
        "meta": {
            "fetched_at": _format_iso_utc(now),
            "api_version": "2023-06-01",
        },
    }
