/**
 * Lambda handler — entry point for the Claude Metrics function.
 *
 * Fetches all data from the Anthropic Admin API in parallel,
 * aggregates it into a ClaudeMetricsResponse, and returns it.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { AnthropicAdminClient } from "./anthropic-admin.js";
import { aggregate, getBillingPeriod, getDateRange } from "./aggregator.js";

export const handler = async (
  event?: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const apiKey = process.env.ANTHROPIC_ADMIN_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        error: "ANTHROPIC_ADMIN_API_KEY environment variable is not set",
      }),
    };
  }

  const client = new AnthropicAdminClient(apiKey);
  const now = new Date();
  const billingPeriod = getBillingPeriod(now);
  const periodStartDt = new Date(billingPeriod.start);
  const dates = getDateRange(periodStartDt, now);

  // Parse optional token limits from env
  const claudeApiTokenLimit = parseInt(
    process.env.CLAUDE_API_TOKEN_LIMIT ?? "50000000",
    10
  );
  const claudeCodeTokenLimit = parseInt(
    process.env.CLAUDE_CODE_TOKEN_LIMIT ?? "50000000",
    10
  );

  try {
    // Fetch everything in parallel
    const [
      org,
      usageReport,
      usageByModel,
      costReport,
      claudeCodeReports,
      workspaces,
      members,
      apiKeys,
    ] = await Promise.all([
      client.getOrganization(),
      client.getUsageReport({
        starting_at: billingPeriod.start,
        ending_at: now.toISOString(),
      }),
      client.getUsageReportByModel({
        starting_at: billingPeriod.start,
        ending_at: now.toISOString(),
      }),
      client.getCostReport({
        starting_at: billingPeriod.start,
        ending_at: now.toISOString(),
        group_by: "description",
      }),
      client.getClaudeCodeUsageRange(dates),
      client.listWorkspaces(),
      client.listMembers(),
      client.listApiKeys(),
    ]);

    const response = aggregate({
      org,
      usageReport,
      usageByModel,
      costReport,
      claudeCodeReports,
      workspaces,
      members,
      apiKeys,
      now,
      claudeApiTokenLimit,
      claudeCodeTokenLimit,
    });

    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(response, null, 2),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Failed to fetch Claude metrics:", message);

    return {
      statusCode: 502,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        error: "Failed to fetch metrics from Anthropic Admin API",
        detail: message,
      }),
    };
  }
};
