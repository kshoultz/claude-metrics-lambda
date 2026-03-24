# CLAUDE.md

## Project Overview

TypeScript and Python Lambda functions that fetch Anthropic account metrics via the Admin API. Both implementations produce identical JSON output.

## Architecture

- **TypeScript Lambda** (`src/`): Node.js 18, esbuild bundled, zero runtime deps (native fetch)
- **Python Lambda** (`python/src/`): Python 3.11, zero runtime deps (urllib.request, concurrent.futures)
- **Deployment**: LocalStack via Docker (primary), AWS Lambda (production)

## Critical Rules

### Zero Runtime Dependencies
Both implementations use only standard library. No npm packages in production. No pip packages in production. This is non-negotiable.

### Output Parity
Both implementations MUST produce identical JSON output for the same input. If you change the response shape in one, change it in both. Tests use identical mock data — keep them in sync.

### API Field Names
The Anthropic Admin API uses `starting_at`/`ending_at` for bucket fields (NOT `bucket_start_time`). Array parameters require bracket notation: `group_by[]` (NOT `group_by`). Always verify field names against actual API responses.

### Rounding Parity
Python's `round()` uses banker's rounding. JavaScript's `Math.round()` uses round-half-up. The Python code uses custom rounding (`math.floor(n * K + 0.5) / K`) to match JS behavior. Do not replace this with Python's built-in `round()`.

### ISO Datetime Format
JavaScript `toISOString()` produces `YYYY-MM-DDTHH:MM:SS.mmmZ` (3-digit ms, Z suffix). Python `isoformat()` produces a different format. The Python code uses `_format_iso_utc()` to match JS output. Do not replace this with `datetime.isoformat()`.

## Testing

- **TypeScript**: vitest (`npm test`)
- **Python**: pytest (`cd python && python -m pytest`)
- **Docker** (preferred): `docker compose --profile test up test-ts test-python`
- Both test suites must have identical test cases with identical mock data

## Docker is Primary

`docker compose up` builds, deploys, and invokes both lambdas. No host dependencies beyond Docker. The host-based scripts (`scripts/deploy-local.sh`, `python/scripts/deploy-local.sh`) are secondary and require Node.js, Python, and AWS CLI installed locally.

## Deploy Scripts

All deploy scripts use `aws --endpoint-url` to talk to LocalStack. Do NOT use `awslocal` — it's an extra dependency that most developers won't have.

## Don't

- Don't add runtime dependencies
- Don't commit `.env` files
- Don't change one implementation without updating the other
- Don't use Python's `round()` for financial or percentage calculations
- Don't use `awslocal` in scripts
- Don't assume `bucket_start_time` — the Anthropic API uses `starting_at`
