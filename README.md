# claude-metrics-lambda

Lambda that fetches your Anthropic account metrics via the Admin API and returns a single shaped response: token capacity, cost tracking, usage breakdown, and account info.

Available in **TypeScript** and **Python** — both produce identical JSON output.

## Prerequisites

- [Node.js](https://nodejs.org/) >= 18 (for TypeScript Lambda)
- [Python](https://www.python.org/) >= 3.11 (for Python Lambda)
- [Docker](https://www.docker.com/)
- [AWS CLI](https://aws.amazon.com/cli/)

## Quick Start (TypeScript)

```bash
npm install
cp .env.example .env
# Edit .env and set ANTHROPIC_ADMIN_API_KEY
# Get one from: https://console.anthropic.com/settings/admin-keys

docker compose up -d
npm run deploy:local
aws --endpoint-url http://localhost:4566 lambda invoke --function-name claude-metrics --region us-east-1 /dev/stdout
```

Or run directly without Docker: `npm run invoke`

## Quick Start (Python)

```bash
cd python
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"

# From project root
docker compose up -d
./python/scripts/deploy-local.sh
aws --endpoint-url http://localhost:4566 lambda invoke --function-name claude-metrics-python --region us-east-1 /dev/stdout
```

Or run directly without Docker: `python scripts/invoke_local.py`

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

## Tests

```bash
# TypeScript
npm test

# Python
cd python && source .venv/bin/activate && python -m pytest -v
```

## Project Structure

```
src/                          # TypeScript Lambda
├── index.ts              # Lambda handler
├── anthropic-admin.ts    # Admin API client (native fetch, zero deps)
├── aggregator.ts         # Data shaping + math
└── types.ts              # All TypeScript interfaces

python/                       # Python Lambda
├── src/
│   ├── handler.py        # Lambda handler
│   ├── anthropic_admin.py # Admin API client (urllib.request, zero deps)
│   ├── aggregator.py     # Data shaping + math
│   └── types.py          # TypedDict definitions
├── tests/
│   └── test_aggregator.py
├── scripts/
│   ├── invoke_local.py
│   └── deploy-local.sh
├── Dockerfile
└── pyproject.toml
```

## License

MIT
