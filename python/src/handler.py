"""
Lambda handler — entry point for the Claude Metrics function (Python).

Fetches all data from the Anthropic Admin API in parallel,
aggregates it into a ClaudeMetricsResponse, and returns it.
"""

from __future__ import annotations

import json
import os
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

from .aggregator import aggregate, get_billing_period, get_date_range
from .anthropic_admin import AnthropicAdminClient


def handler(event=None, context=None):
    api_key = os.environ.get("ANTHROPIC_ADMIN_API_KEY")
    if not api_key:
        return {
            "statusCode": 500,
            "headers": {"content-type": "application/json"},
            "body": json.dumps({
                "error": "ANTHROPIC_ADMIN_API_KEY environment variable is not set",
            }),
        }

    client = AnthropicAdminClient(api_key)
    now = datetime.now(timezone.utc)
    billing_period = get_billing_period(now)
    period_start_dt = datetime.fromisoformat(billing_period["start"].replace("Z", "+00:00"))
    dates = get_date_range(period_start_dt, now)

    # Parse optional token limits from env
    claude_api_token_limit = int(os.environ.get("CLAUDE_API_TOKEN_LIMIT", "50000000"))
    claude_code_token_limit = int(os.environ.get("CLAUDE_CODE_TOKEN_LIMIT", "50000000"))

    now_iso = now.isoformat()

    try:
        # Fetch everything in parallel
        with ThreadPoolExecutor(max_workers=8) as executor:
            f_org = executor.submit(client.get_organization)
            f_usage = executor.submit(
                client.get_usage_report,
                starting_at=billing_period["start"],
                ending_at=now_iso,
            )
            f_usage_model = executor.submit(
                client.get_usage_report_by_model,
                starting_at=billing_period["start"],
                ending_at=now_iso,
            )
            f_cost = executor.submit(
                client.get_cost_report,
                starting_at=billing_period["start"],
                ending_at=now_iso,
            )
            f_code = executor.submit(client.get_claude_code_usage_range, dates)
            f_ws = executor.submit(client.list_workspaces)
            f_members = executor.submit(client.list_members)
            f_keys = executor.submit(client.list_api_keys)

        response = aggregate({
            "org": f_org.result(),
            "usage_report": f_usage.result(),
            "usage_by_model": f_usage_model.result(),
            "cost_report": f_cost.result(),
            "claude_code_reports": f_code.result(),
            "workspaces": f_ws.result(),
            "members": f_members.result(),
            "api_keys": f_keys.result(),
            "now": now,
            "claude_api_token_limit": claude_api_token_limit,
            "claude_code_token_limit": claude_code_token_limit,
        })

        return {
            "statusCode": 200,
            "headers": {"content-type": "application/json"},
            "body": json.dumps(response, indent=2),
        }
    except Exception as err:
        message = str(err)
        print(f"Failed to fetch Claude metrics: {message}")

        return {
            "statusCode": 502,
            "headers": {"content-type": "application/json"},
            "body": json.dumps({
                "error": "Failed to fetch metrics from Anthropic Admin API",
                "detail": message,
            }),
        }
