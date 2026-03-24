#!/usr/bin/env bash
set -euo pipefail

# Deploy the Claude Metrics Lambda (Python) to LocalStack.
#
# Prerequisites:
#   1. docker compose up -d
#   2. Copy .env.example to .env and set ANTHROPIC_ADMIN_API_KEY
#   3. AWS CLI installed (https://aws.amazon.com/cli/)
#
# Usage:
#   ./python/scripts/deploy-local.sh

FUNCTION_NAME="claude-metrics-python"
REGION="us-east-1"
ENDPOINT="http://localhost:4566"

# Wrapper: aws CLI pointed at LocalStack
awsl() { aws --endpoint-url "$ENDPOINT" "$@"; }

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "==> Packaging Python Lambda..."
cd "$PROJECT_DIR"
rm -rf dist
mkdir -p dist

# Copy source into dist for zipping
cp -r src dist/
cd dist
zip -qr function.zip src/
cd "$PROJECT_DIR"

# Load .env file for the API key (check both python/ and root)
if [ -f ../.env ]; then
  # shellcheck disable=SC1091
  source ../.env
fi
if [ -f .env ]; then
  # shellcheck disable=SC1091
  source .env
fi

if [ -z "${ANTHROPIC_ADMIN_API_KEY:-}" ]; then
  echo "ERROR: ANTHROPIC_ADMIN_API_KEY not set. Copy .env.example to .env and add your key."
  exit 1
fi

ENV_VARS="{\"Variables\":{\"ANTHROPIC_ADMIN_API_KEY\":\"${ANTHROPIC_ADMIN_API_KEY}\""
if [ -n "${CLAUDE_API_TOKEN_LIMIT:-}" ]; then
  ENV_VARS="${ENV_VARS},\"CLAUDE_API_TOKEN_LIMIT\":\"${CLAUDE_API_TOKEN_LIMIT}\""
fi
if [ -n "${CLAUDE_CODE_TOKEN_LIMIT:-}" ]; then
  ENV_VARS="${ENV_VARS},\"CLAUDE_CODE_TOKEN_LIMIT\":\"${CLAUDE_CODE_TOKEN_LIMIT}\""
fi
ENV_VARS="${ENV_VARS}}}"

# Check if function exists
if awsl lambda get-function --function-name "$FUNCTION_NAME" --region "$REGION" &>/dev/null; then
  echo "==> Updating existing function..."
  awsl lambda update-function-code \
    --function-name "$FUNCTION_NAME" \
    --zip-file fileb://dist/function.zip \
    --region "$REGION" \
    --no-cli-pager

  awsl lambda update-function-configuration \
    --function-name "$FUNCTION_NAME" \
    --environment "$ENV_VARS" \
    --region "$REGION" \
    --no-cli-pager
else
  echo "==> Creating function..."
  # Create execution role first
  awsl iam create-role \
    --role-name lambda-role \
    --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}' \
    --region "$REGION" \
    --no-cli-pager 2>/dev/null || true

  awsl lambda create-function \
    --function-name "$FUNCTION_NAME" \
    --runtime python3.11 \
    --handler src.handler.handler \
    --zip-file fileb://dist/function.zip \
    --role arn:aws:iam::000000000000:role/lambda-role \
    --timeout 30 \
    --memory-size 256 \
    --environment "$ENV_VARS" \
    --region "$REGION" \
    --no-cli-pager
fi

echo ""
echo "==> Deployed! Invoke with:"
echo ""
echo "  aws --endpoint-url $ENDPOINT lambda invoke --function-name $FUNCTION_NAME --region $REGION /dev/stdout"
echo ""
