FROM public.ecr.aws/lambda/python:3.11

# Copy source (zero runtime deps — no pip install needed)
COPY src/ ${LAMBDA_TASK_ROOT}/src/

CMD ["src.handler.handler"]
