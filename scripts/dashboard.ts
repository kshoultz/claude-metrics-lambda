/**
 * Terminal dashboard — fetches Claude metrics and displays a formatted summary.
 *
 * Usage:
 *   cp .env.example .env   # add your API key
 *   npm run dashboard
 */

import { config } from "dotenv";
config();

import { handler } from "../src/index.js";

// ── ANSI helpers ────────────────────────────────────────────────────
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;

function bar(pct: number, width = 20): string {
  const filled = pct > 0 ? Math.max(1, Math.round((pct / 100) * width)) : 0;
  const empty = width - filled;
  const color = pct < 50 ? green : pct < 80 ? yellow : red;
  return color("█".repeat(filled)) + dim("░".repeat(empty));
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function fmtUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}

function shortModel(model: string): string {
  return model
    .replace("claude-", "")
    .replace("-20250514", "")
    .replace("-20251001", "");
}

// ── Main ────────────────────────────────────────────────────────────
async function main() {
  const result = await handler();

  if (result.statusCode !== 200) {
    console.error(`Error (${result.statusCode}):`, result.body);
    process.exit(1);
  }

  const data = JSON.parse(result.body);
  const bp = data.billing_period;
  const api = data.capacity.claude_api;
  const code = data.capacity.claude_code;
  const cost = data.cost;
  const usage = data.usage.claude_api;
  const account = data.account;

  const W = 48;
  const line = "─".repeat(W);
  const pad = (s: string, w: number) => s + " ".repeat(Math.max(0, w - s.length));

  console.log("");
  console.log(`┌${line}┐`);
  console.log(`│ ${bold("Claude Metrics")}${" ".repeat(W - 15)}│`);
  console.log(`│ ${dim(`${account.organization_name} • Day ${Math.floor(bp.days_elapsed)} of ${bp.days_total}`)}${" ".repeat(Math.max(0, W - account.organization_name.length - 16 - String(Math.floor(bp.days_elapsed)).length - String(bp.days_total).length))}│`);
  console.log(`├${line}┤`);

  // Token capacity
  const tokLine = `${fmtTokens(api.tokens_used)} / ${fmtTokens(api.token_limit)}`;
  const burnLine = `${fmtTokens(api.daily_burn_rate)}/day → ${fmtTokens(api.projected_tokens_at_period_end)} projected`;
  console.log(`│ ${bold("API TOKENS")}  ${bar(api.usage_pct)}  ${api.usage_pct}%${" ".repeat(Math.max(0, W - 37 - String(api.usage_pct).length))}│`);
  console.log(`│ ${pad(tokLine, W - 1)}│`);
  console.log(`│ ${pad(dim(burnLine), W - 1)}│`);

  if (api.days_until_exhaustion != null) {
    const exLine = red(`⚠ ${api.days_until_exhaustion} days until exhaustion`);
    console.log(`│ ${pad(exLine, W - 1)}│`);
  }

  // Claude Code capacity
  if (code) {
    console.log(`├${line}┤`);
    const codeTok = `${fmtTokens(code.tokens_used)} / ${fmtTokens(code.token_limit)}`;
    console.log(`│ ${bold("CLAUDE CODE")}  ${bar(code.usage_pct)}  ${code.usage_pct}%${" ".repeat(Math.max(0, W - 38 - String(code.usage_pct).length))}│`);
    console.log(`│ ${pad(codeTok, W - 1)}│`);
    for (const u of (code.per_user ?? []).slice(0, 5)) {
      const userLine = `  ${u.email}: ${fmtTokens(u.tokens_used)}`;
      console.log(`│ ${pad(dim(userLine), W - 1)}│`);
    }
  }

  // Cost
  console.log(`├${line}┤`);
  const costLine = `${fmtUsd(cost.current_spend_usd)} spent → ${fmtUsd(cost.projected_spend_usd)} projected`;
  console.log(`│ ${bold("COST")}${" ".repeat(W - 5)}│`);
  console.log(`│ ${pad(costLine, W - 1)}│`);
  console.log(`│ ${pad(dim(`${fmtUsd(cost.daily_burn_rate_usd)}/day`), W - 1)}│`);

  // Cost by model
  if (cost.by_model?.length > 0) {
    for (const m of cost.by_model.slice(0, 5)) {
      const mLine = `  ${pad(m.model === "unknown" ? "other" : shortModel(m.model), 28)} ${fmtUsd(m.cost_usd)}`;
      console.log(`│ ${pad(dim(mLine), W - 1)}│`);
    }
  }

  // Top models by usage
  console.log(`├${line}┤`);
  console.log(`│ ${bold("TOP MODELS")}${" ".repeat(W - 11)}│`);
  for (const m of usage.by_model.slice(0, 5)) {
    const mLine = `  ${pad(shortModel(m.model), 30)} ${fmtTokens(m.tokens)}`;
    console.log(`│ ${pad(mLine, W - 1)}│`);
  }

  // Account
  console.log(`├${line}┤`);
  console.log(`│ ${pad(dim(`${account.members.length} member${account.members.length !== 1 ? "s" : ""} • ${account.api_keys.active} active key${account.api_keys.active !== 1 ? "s" : ""} • resets ${bp.resets_at.slice(0, 10)}`), W - 1)}│`);

  console.log(`└${line}┘`);
  console.log("");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
