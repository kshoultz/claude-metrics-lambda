# Claude Metrics Lambda (Python)

Python implementation of the Claude Metrics Lambda — functionally identical to the TypeScript version. Fetches Anthropic account usage metrics via the Admin API and returns a comprehensive JSON response.

## Zero Dependencies

Uses only Python standard library at runtime:
- `urllib.request` for HTTP calls
- `concurrent.futures` for parallel requests
- `json`, `datetime`, `math` for data processing

## Quick Start

```bash
# From the python/ directory
cd python

# Create and activate a virtual environment
python3 -m venv .venv
source .venv/bin/activate

# Install dev dependencies
pip install -e ".[dev]"

# Run tests
python -m pytest -v

# Invoke locally (requires ANTHROPIC_ADMIN_API_KEY in ../.env or .env)
python scripts/invoke_local.py

# Type check
mypy src/
```

## Deploy to LocalStack

```bash
# From project root
docker compose up -d
./python/scripts/deploy-local.sh

# Invoke
aws --endpoint-url http://localhost:4566 lambda invoke --function-name claude-metrics-python --region us-east-1 /dev/stdout
```

## Project Structure

```
python/
├── src/
│   ├── handler.py            # Lambda entry point
│   ├── types.py              # TypedDict definitions
│   ├── anthropic_admin.py    # Admin API client
│   └── aggregator.py         # Data aggregation logic
├── tests/
│   └── test_aggregator.py    # Unit tests (pytest)
├── scripts/
│   ├── invoke_local.py       # Local invocation
│   └── deploy-local.sh       # LocalStack deployment
├── Dockerfile                # Python 3.11 Lambda container
└── pyproject.toml            # Project config
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ANTHROPIC_ADMIN_API_KEY` | Yes | — | `sk-ant-admin-*` key from console.anthropic.com |
| `CLAUDE_API_TOKEN_LIMIT` | No | `50000000` | Token limit for Claude API capacity calculations |
| `CLAUDE_CODE_TOKEN_LIMIT` | No | `50000000` | Token limit for Claude Code capacity calculations |
