"""
TypedDict definitions for Claude Metrics Lambda.

Output types mirror ClaudeMetricsResponse from the TypeScript version.
Raw types mirror the Anthropic Admin API response shapes.
"""

from __future__ import annotations

from typing import NotRequired, Optional, TypedDict


# ============================================================================
# Claude Metrics Response — the shaped output
# ============================================================================


class CapacityMetrics(TypedDict):
    tokens_used: int
    token_limit: int
    tokens_remaining: int
    usage_pct: float
    daily_burn_rate: int
    projected_tokens_at_period_end: int
    days_until_exhaustion: Optional[float]


class CapacityPerUser(TypedDict):
    email: str
    tokens_used: int


class CodeCapacityMetrics(CapacityMetrics):
    per_user: list[CapacityPerUser]


class CostByModel(TypedDict):
    model: str
    cost_usd: float
    tokens_used: int


class DailyCost(TypedDict):
    date: str
    cost_usd: float


class CostMetrics(TypedDict):
    current_spend_usd: float
    projected_spend_usd: float
    daily_burn_rate_usd: float
    by_model: list[CostByModel]
    daily: list[DailyCost]


class ModelUsage(TypedDict):
    model: str
    tokens: int


class DailyTokens(TypedDict):
    date: str
    tokens: int


class UsageBreakdown(TypedDict):
    input_tokens: int
    output_tokens: int
    cache_read_tokens: int
    cache_creation_tokens: int
    by_model: list[ModelUsage]
    daily: list[DailyTokens]


class CodePerUser(TypedDict):
    email: str
    tokens: int
    models_used: list[str]


class CodeUsageBreakdown(UsageBreakdown):
    per_user: list[CodePerUser]


class WorkspaceInfo(TypedDict):
    id: str
    name: str
    archived: bool


class MemberInfo(TypedDict):
    id: str
    name: str
    email: str
    role: str


class ApiKeyInfo(TypedDict):
    id: str
    name: str
    status: str
    workspace_id: Optional[str]


class ApiKeySummary(TypedDict):
    total: int
    active: int
    keys: list[ApiKeyInfo]


class AccountInfo(TypedDict):
    organization_name: str
    organization_id: str
    workspaces: list[WorkspaceInfo]
    members: list[MemberInfo]
    api_keys: ApiKeySummary


class BillingPeriod(TypedDict):
    start: str
    end: str
    days_total: int
    days_elapsed: float
    days_remaining: float
    resets_at: str


class MetaInfo(TypedDict):
    fetched_at: str
    api_version: str


class ClaudeMetricsResponse(TypedDict):
    capacity: dict  # {claude_api: CapacityMetrics, claude_code: CodeCapacityMetrics | None}
    cost: CostMetrics
    usage: dict  # {claude_api: UsageBreakdown, claude_code: CodeUsageBreakdown | None}
    account: AccountInfo
    billing_period: BillingPeriod
    meta: MetaInfo


# ============================================================================
# Raw Anthropic Admin API response types
# ============================================================================


# GET /v1/organizations/me
class RawOrganization(TypedDict):
    id: str
    name: str
    created_at: NotRequired[str]


# GET /v1/organizations/usage_report/messages
class RawCacheCreation(TypedDict, total=False):
    ephemeral_5m_input_tokens: int
    ephemeral_1h_input_tokens: int


class RawUsageResult(TypedDict, total=False):
    uncached_input_tokens: int
    cache_read_input_tokens: int
    output_tokens: int
    cache_creation: RawCacheCreation
    model: str
    api_key_id: str
    workspace_id: str


class RawUsageBucket(TypedDict):
    bucket_start_time: str
    results: list[RawUsageResult]


class RawUsageReport(TypedDict):
    data: list[RawUsageBucket]
    has_more: bool
    next_page: NotRequired[str]


# GET /v1/organizations/cost_report
class RawCostResult(TypedDict, total=False):
    amount: str  # cents as decimal string
    model: str
    workspace_id: str


class RawCostBucket(TypedDict):
    bucket_start_time: str
    results: list[RawCostResult]


class RawCostReport(TypedDict):
    data: list[RawCostBucket]
    has_more: bool
    next_page: NotRequired[str]


# GET /v1/organizations/usage_report/claude_code
class RawClaudeCodeTokens(TypedDict):
    input: int
    output: int
    cache_read: int
    cache_creation: int


class RawClaudeCodeCost(TypedDict):
    amount: float  # cents
    currency: str


class RawClaudeCodeModelBreakdown(TypedDict):
    model: str
    tokens: RawClaudeCodeTokens
    estimated_cost: RawClaudeCodeCost


class RawClaudeCodeActor(TypedDict):
    type: str
    email_address: str
    name: NotRequired[str]


class RawClaudeCodeRecord(TypedDict):
    date: str
    actor: RawClaudeCodeActor
    model_breakdown: list[RawClaudeCodeModelBreakdown]


class RawClaudeCodeReport(TypedDict):
    data: list[RawClaudeCodeRecord]
    has_more: bool
    next_page: NotRequired[str]


# GET /v1/organizations/workspaces
class RawWorkspace(TypedDict):
    id: str
    name: str
    display_name: NotRequired[str]
    created_at: str
    archived_at: NotRequired[Optional[str]]


class RawWorkspacesResponse(TypedDict):
    data: list[RawWorkspace]
    has_more: bool
    first_id: NotRequired[str]
    last_id: NotRequired[str]


# GET /v1/organizations/users
class RawMember(TypedDict):
    id: str
    name: str
    email: str
    role: str
    created_at: str


class RawMembersResponse(TypedDict):
    data: list[RawMember]
    has_more: bool
    first_id: NotRequired[str]
    last_id: NotRequired[str]


# GET /v1/organizations/api_keys
class RawApiKeyCreatedBy(TypedDict):
    id: str
    name: str


class RawApiKey(TypedDict):
    id: str
    name: str
    status: str
    workspace_id: NotRequired[Optional[str]]
    created_at: str
    created_by: NotRequired[RawApiKeyCreatedBy]


class RawApiKeysResponse(TypedDict):
    data: list[RawApiKey]
    has_more: bool
    first_id: NotRequired[str]
    last_id: NotRequired[str]
