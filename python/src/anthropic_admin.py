"""
Anthropic Admin API client — thin, typed, zero-dependency (urllib.request).

Requires an sk-ant-admin-* key from:
https://console.anthropic.com/settings/admin-keys
"""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Optional

BASE_URL = "https://api.anthropic.com"
API_VERSION = "2023-06-01"


class AnthropicAdminClient:
    def __init__(self, api_key: str, base_url: str = BASE_URL) -> None:
        if not api_key:
            raise ValueError(
                "ANTHROPIC_ADMIN_API_KEY is required. "
                "Get one at https://console.anthropic.com/settings/admin-keys"
            )
        self._api_key = api_key
        self._base_url = base_url
        self._headers = {
            "x-api-key": self._api_key,
            "anthropic-version": API_VERSION,
            "content-type": "application/json",
        }

    # -- HTTP helpers ----------------------------------------------------------

    def _get(
        self,
        path: str,
        params: Optional[dict[str, Any]] = None,
    ) -> dict:
        url = f"{self._base_url}{path}"
        if params:
            filtered = {
                k: str(v) for k, v in params.items() if v is not None
            }
            if filtered:
                url = f"{url}?{urllib.parse.urlencode(filtered)}"

        req = urllib.request.Request(url, headers=self._headers, method="GET")

        try:
            with urllib.request.urlopen(req) as resp:
                body = resp.read().decode("utf-8")
                return json.loads(body)
        except urllib.error.HTTPError as e:
            error_body = e.read().decode("utf-8") if e.fp else ""
            raise RuntimeError(
                f"Anthropic Admin API {e.code}: {e.reason} — {error_body}"
            ) from e

    # -- Organization ----------------------------------------------------------

    def get_organization(self) -> dict:
        return self._get("/v1/organizations/me")

    # -- Usage Reports ---------------------------------------------------------

    def get_usage_report(
        self,
        *,
        starting_at: str,
        ending_at: str,
        bucket_width: str = "1d",
        group_by: Optional[str] = None,
        model: Optional[str] = None,
        limit: int = 31,
        page: Optional[str] = None,
    ) -> dict:
        params: dict[str, Any] = {
            "starting_at": starting_at,
            "ending_at": ending_at,
            "bucket_width": bucket_width,
            "limit": limit,
        }
        if group_by:
            params["group_by[]"] = group_by
        if model:
            params["model"] = model
        if page:
            params["page"] = page
        return self._get("/v1/organizations/usage_report/messages", params)

    def get_usage_report_by_model(
        self,
        *,
        starting_at: str,
        ending_at: str,
        bucket_width: str = "1d",
        limit: int = 31,
    ) -> dict:
        return self.get_usage_report(
            starting_at=starting_at,
            ending_at=ending_at,
            bucket_width=bucket_width,
            limit=limit,
            group_by="model",
        )

    # -- Cost Reports ----------------------------------------------------------

    def get_cost_report(
        self,
        *,
        starting_at: str,
        ending_at: str,
        bucket_width: str = "1d",
        group_by: Optional[str] = None,
        limit: int = 31,
        page: Optional[str] = None,
    ) -> dict:
        params: dict[str, Any] = {
            "starting_at": starting_at,
            "ending_at": ending_at,
            "bucket_width": bucket_width,
            "limit": limit,
        }
        if group_by:
            params["group_by[]"] = group_by
        if page:
            params["page"] = page
        return self._get("/v1/organizations/cost_report", params)

    # -- Claude Code Usage -----------------------------------------------------

    def get_claude_code_usage(
        self,
        *,
        starting_at: str,
        limit: int = 1000,
        page: Optional[str] = None,
    ) -> dict:
        params: dict[str, Any] = {
            "starting_at": starting_at,
            "limit": limit,
        }
        if page:
            params["page"] = page
        return self._get("/v1/organizations/usage_report/claude_code", params)

    def get_claude_code_usage_range(self, dates: list[str]) -> list[dict]:
        """Fetch Claude Code usage for multiple days in parallel.

        The API requires one call per day. Failed days are silently skipped
        (mirrors Promise.allSettled semantics in the TypeScript version).
        """
        if not dates:
            return []

        reports: list[dict] = []
        with ThreadPoolExecutor(max_workers=min(len(dates), 10)) as executor:
            futures = {
                executor.submit(self.get_claude_code_usage, starting_at=date): date
                for date in dates
            }
            for future in as_completed(futures):
                try:
                    reports.append(future.result())
                except Exception:
                    pass  # Silently skip failed days
        return reports

    # -- Workspaces ------------------------------------------------------------

    def list_workspaces(
        self,
        *,
        limit: int = 100,
        include_archived: bool = True,
    ) -> dict:
        return self._get("/v1/organizations/workspaces", {
            "limit": limit,
            "include_archived": str(include_archived).lower(),
        })

    # -- Members ---------------------------------------------------------------

    def list_members(self, *, limit: int = 100) -> dict:
        return self._get("/v1/organizations/users", {"limit": limit})

    # -- API Keys --------------------------------------------------------------

    def list_api_keys(
        self,
        *,
        limit: int = 100,
        status: Optional[str] = None,
    ) -> dict:
        params: dict[str, Any] = {"limit": limit}
        if status:
            params["status"] = status
        return self._get("/v1/organizations/api_keys", params)
