# claude-metrics-lambda

> **TL;DR:** One Lambda call → your complete Anthropic account metrics (tokens, spend, projections, per-user breakdown) as a single JSON response. [Why?](#why-this-lambda)

Lambda that fetches your Anthropic account metrics via the Admin API and returns a single shaped response: token capacity, cost tracking, usage breakdown, and account info.

Available in **TypeScript** and **Python** — both produce identical JSON output.

## Quick Start

Only Docker required. No local Node.js, Python, or AWS CLI needed.

```bash
cp .env.example .env          # add your ANTHROPIC_ADMIN_API_KEY
docker compose up              # deploys and invokes both lambdas
```

Get an Admin API key from: https://console.anthropic.com/settings/admin-keys

## Dashboard

View your metrics in a formatted terminal display — no Docker or Lambda needed. Calls the Anthropic API directly from Node.js.

```bash
npm install                    # first time only
npm run dashboard
```

Requires Node.js >= 18 and `ANTHROPIC_ADMIN_API_KEY` in your `.env`.

## Run Tests

```bash
docker compose --profile test up test-ts test-python
```

## What You Get

A single JSON response answering two questions:

**Will I run out of tokens?** — tokens used/remaining/limit, daily burn rate, projected end-of-month usage, days until exhaustion

**How much have I spent?** — current spend, projected monthly, daily burn rate, cost by model, daily trend

Plus: full usage breakdown (input/output/cache), Claude Code per-user stats, account info (org, workspaces, members, API keys), and billing period details.

## Response Shape

```typescript
{
  capacity: {
    claude_api: { tokens_used, token_limit, tokens_remaining, usage_pct, daily_burn_rate, projected_tokens_at_period_end, days_until_exhaustion },
    claude_code: { ...same, per_user: [{ email, tokens_used }] } | null
  },
  cost: {
    current_spend_usd, projected_spend_usd, daily_burn_rate_usd,
    by_model: [{ model, cost_usd, tokens_used }],
    daily: [{ date, cost_usd }]
  },
  usage: {
    claude_api: { input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, by_model, daily },
    claude_code: { ...same, per_user: [{ email, tokens, models_used }] } | null
  },
  account: { organization_name, organization_id, workspaces, members, api_keys },
  billing_period: { start, end, days_total, days_elapsed, days_remaining, resets_at },
  meta: { fetched_at, api_version }
}
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ANTHROPIC_ADMIN_API_KEY` | Yes | — | Admin API key (`sk-ant-admin-...`) |
| `CLAUDE_API_TOKEN_LIMIT` | No | `50000000` | Token limit for capacity calculations |
| `CLAUDE_CODE_TOKEN_LIMIT` | No | `50000000` | Claude Code token limit |

## Project Structure

Two functionally identical Lambda implementations that produce the same JSON output.

```
src/                          # TypeScript Lambda
├── index.ts
├── anthropic-admin.ts
├── aggregator.ts
└── types.ts

python/src/                   # Python Lambda
├── handler.py
├── anthropic_admin.py
├── aggregator.py
└── types.py
```

## Alternative: Run Without Docker

Requires Node.js >= 18, Python >= 3.11, and AWS CLI on your host.

```bash
# TypeScript — run directly
npm install
npm run invoke

# TypeScript — deploy to LocalStack
npm run deploy:local

# Python — run directly
cd python && python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]" && python scripts/invoke_local.py

# Python — deploy to LocalStack
./python/scripts/deploy-local.sh

# Unit tests
npm test
cd python && source .venv/bin/activate && python -m pytest -v
```

## Why This Lambda?

The Anthropic Admin API spreads account metrics across multiple endpoints — usage reports, cost reports, Claude Code usage (one call per day), workspaces, members, and API keys. Getting a complete picture requires orchestrating 8+ API calls, parsing different response formats, and doing the math (burn rates, projections, exhaustion dates).

This Lambda does all of that in a single invocation and returns one shaped JSON response. Deploy it on a schedule (CloudWatch Events, cron) and pipe the output to a dashboard, Slack alert, or monitoring system.

## Why This Repository?

This is a reference implementation for consuming the Anthropic Admin API. It's designed to be cloned, modified, and deployed — not installed as a package. Two implementations (TypeScript and Python) are provided so you can pick whichever fits your stack, or use both as a Rosetta Stone for porting the logic elsewhere.

## License

MIT
