# claude-metrics

TypeScript Lambda that fetches your Anthropic account metrics via the Admin API and returns a single shaped response with everything you need: token capacity, cost tracking, usage breakdown, and account info.

## Quick Start

### 1. Clone and install

```bash
git clone https://github.com/YOUR_USER/claude-metrics.git
cd claude-metrics
npm install
```

### 2. Add your API key

```bash
cp .env.example .env
# Edit .env and set ANTHROPIC_ADMIN_API_KEY
```

Get an Admin API key from: https://console.anthropic.com/settings/admin-keys

### 3. Run locally (no Docker needed)

```bash
npm run invoke
```

### 4. Run via Docker + LocalStack

```bash
docker compose up -d
npm run deploy:local

# Invoke the Lambda
awslocal lambda invoke --function-name claude-metrics --region us-east-1 /dev/stdout
```

## What You Get

A single JSON response organized around two questions:

**Will I run out of tokens?**
- Tokens used / remaining / limit
- Daily burn rate
- Projected tokens at period end
- Days until exhaustion (null if you won't hit the limit)

**How much have I spent?**
- Current spend in USD
- Projected monthly spend
- Daily burn rate in USD
- Cost breakdown by model
- Daily cost for sparkline/trend

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

## Tests

```bash
npm test
```

## Project Structure

```
src/
├── index.ts              # Lambda handler
├── anthropic-admin.ts    # Typed Admin API client (native fetch, zero deps)
├── aggregator.ts         # Data shaping + math (token sums, cost projection, burn rate)
└── types.ts              # All TypeScript interfaces
```

## License

MIT
