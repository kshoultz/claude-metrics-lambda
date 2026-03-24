/**
 * Anthropic Admin API client — thin, typed, zero-dependency (native fetch).
 *
 * Requires an sk-ant-admin-* key from:
 * https://console.anthropic.com/settings/admin-keys
 */

import type {
  RawApiKeysResponse,
  RawClaudeCodeReport,
  RawCostReport,
  RawMembersResponse,
  RawOrganization,
  RawUsageReport,
  RawWorkspacesResponse,
} from "./types.js";

const BASE_URL = "https://api.anthropic.com";
const API_VERSION = "2023-06-01";

export class AnthropicAdminClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;

  constructor(apiKey: string, baseUrl = BASE_URL) {
    if (!apiKey) {
      throw new Error(
        "ANTHROPIC_ADMIN_API_KEY is required. " +
          "Get one at https://console.anthropic.com/settings/admin-keys"
      );
    }
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.headers = {
      "x-api-key": this.apiKey,
      "anthropic-version": API_VERSION,
      "content-type": "application/json",
    };
  }

  // ── HTTP helpers ─────────────────────────────────────────────

  private async get<T>(
    path: string,
    params?: Record<string, string | number | boolean>
  ): Promise<T> {
    const url = new URL(path, this.baseUrl);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: this.headers,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Anthropic Admin API ${response.status}: ${response.statusText} — ${body}`
      );
    }

    return (await response.json()) as T;
  }

  // ── Organization ─────────────────────────────────────────────

  async getOrganization(): Promise<RawOrganization> {
    return this.get<RawOrganization>("/v1/organizations/me");
  }

  // ── Usage Reports ────────────────────────────────────────────

  async getUsageReport(opts: {
    starting_at: string;
    ending_at: string;
    bucket_width?: string;
    group_by?: string;
    model?: string;
    limit?: number;
    page?: string;
  }): Promise<RawUsageReport> {
    return this.get<RawUsageReport>(
      "/v1/organizations/usage_report/messages",
      {
        starting_at: opts.starting_at,
        ending_at: opts.ending_at,
        bucket_width: opts.bucket_width ?? "1d",
        limit: opts.limit ?? 31,
        ...(opts.group_by && { "group_by[]": opts.group_by }),
        ...(opts.model && { model: opts.model }),
        ...(opts.page && { page: opts.page }),
      }
    );
  }

  async getUsageReportByModel(opts: {
    starting_at: string;
    ending_at: string;
    bucket_width?: string;
    limit?: number;
  }): Promise<RawUsageReport> {
    return this.getUsageReport({ ...opts, group_by: "model" });
  }

  // ── Cost Reports ─────────────────────────────────────────────

  async getCostReport(opts: {
    starting_at: string;
    ending_at: string;
    bucket_width?: string;
    group_by?: string;
    limit?: number;
    page?: string;
  }): Promise<RawCostReport> {
    return this.get<RawCostReport>("/v1/organizations/cost_report", {
      starting_at: opts.starting_at,
      ending_at: opts.ending_at,
      bucket_width: opts.bucket_width ?? "1d",
      limit: opts.limit ?? 31,
      ...(opts.group_by && { "group_by[]": opts.group_by }),
      ...(opts.page && { page: opts.page }),
    });
  }

  // ── Claude Code Usage ────────────────────────────────────────

  async getClaudeCodeUsage(opts: {
    starting_at: string;
    limit?: number;
    page?: string;
  }): Promise<RawClaudeCodeReport> {
    return this.get<RawClaudeCodeReport>(
      "/v1/organizations/usage_report/claude_code",
      {
        starting_at: opts.starting_at,
        limit: opts.limit ?? 1000,
        ...(opts.page && { page: opts.page }),
      }
    );
  }

  /**
   * Fetch Claude Code usage for multiple days in parallel.
   * The API requires one call per day.
   */
  async getClaudeCodeUsageRange(
    dates: string[]
  ): Promise<RawClaudeCodeReport[]> {
    const results = await Promise.allSettled(
      dates.map((date) => this.getClaudeCodeUsage({ starting_at: date }))
    );

    const reports: RawClaudeCodeReport[] = [];
    for (const result of results) {
      if (result.status === "fulfilled") {
        reports.push(result.value);
      }
      // Silently skip failed days (matches Python behavior)
    }
    return reports;
  }

  // ── Workspaces ───────────────────────────────────────────────

  async listWorkspaces(opts?: {
    limit?: number;
    include_archived?: boolean;
  }): Promise<RawWorkspacesResponse> {
    return this.get<RawWorkspacesResponse>("/v1/organizations/workspaces", {
      limit: opts?.limit ?? 100,
      include_archived: opts?.include_archived ?? true,
    });
  }

  // ── Members ──────────────────────────────────────────────────

  async listMembers(opts?: {
    limit?: number;
  }): Promise<RawMembersResponse> {
    return this.get<RawMembersResponse>("/v1/organizations/users", {
      limit: opts?.limit ?? 100,
    });
  }

  // ── API Keys ─────────────────────────────────────────────────

  async listApiKeys(opts?: {
    limit?: number;
    status?: string;
  }): Promise<RawApiKeysResponse> {
    return this.get<RawApiKeysResponse>("/v1/organizations/api_keys", {
      limit: opts?.limit ?? 100,
      ...(opts?.status && { status: opts.status }),
    });
  }
}
