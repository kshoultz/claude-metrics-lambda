#!/usr/bin/env bash
set -euo pipefail

# Deploy the Claude Metrics Lambda to LocalStack.
#
# Prerequisites:
#   1. docker compose up -d
#   2. Copy .env.example to .env and set ANTHROPIC_ADMIN_API_KEY
#
# Usage:
#   ./scripts/deploy-local.sh

FUNCTION_NAME="claude-metrics"
LOCALSTACK_URL="http://localhost:4566"
REGION="us-east-1"

echo "==> Building Lambda bundle..."
npx esbuild src/index.ts \
  --bundle \
  --platform=node \
  --target=node18 \
  --outfile=dist/index.mjs \
  --format=esm \
  --banner:js="import { createRequire } from 'module'; const require = createRequire(import.meta.url);"

# Package as zip
echo "==> Packaging..."
cd dist
zip -q function.zip index.mjs
cd ..

# Load .env file for the API key
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
if awslocal lambda get-function --function-name "$FUNCTION_NAME" --region "$REGION" &>/dev/null; then
  echo "==> Updating existing function..."
  awslocal lambda update-function-code \
    --function-name "$FUNCTION_NAME" \
    --zip-file fileb://dist/function.zip \
    --region "$REGION" \
    --no-cli-pager

  awslocal lambda update-function-configuration \
    --function-name "$FUNCTION_NAME" \
    --environment "$ENV_VARS" \
    --region "$REGION" \
    --no-cli-pager
else
  echo "==> Creating function..."
  # Create execution role first
  awslocal iam create-role \
    --role-name lambda-role \
    --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}' \
    --region "$REGION" \
    --no-cli-pager 2>/dev/null || true

  awslocal lambda create-function \
    --function-name "$FUNCTION_NAME" \
    --runtime nodejs18.x \
    --handler index.handler \
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
echo "  awslocal lambda invoke --function-name $FUNCTION_NAME --region $REGION /dev/stdout"
echo ""
echo "  # Or via HTTP (create a function URL first):"
echo "  awslocal lambda create-function-url-config --function-name $FUNCTION_NAME --auth-type NONE --region $REGION"
echo "  curl http://localhost:4566/lambda/$FUNCTION_NAME/invocations -d '{}'"
