FROM public.ecr.aws/lambda/nodejs:18

# Install build tools
RUN npm install -g esbuild

# Copy source
COPY package.json ${LAMBDA_TASK_ROOT}/
COPY src/ ${LAMBDA_TASK_ROOT}/src/

# Bundle the Lambda into a single file
RUN esbuild src/index.ts \
  --bundle \
  --platform=node \
  --target=node18 \
  --outfile=${LAMBDA_TASK_ROOT}/index.mjs \
  --format=esm \
  --banner:js="import { createRequire } from 'module'; const require = createRequire(import.meta.url);"

CMD ["index.handler"]
