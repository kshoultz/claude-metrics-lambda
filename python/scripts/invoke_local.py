#!/usr/bin/env python3
"""
Local invoke — run the Lambda handler directly without Docker/LocalStack.

Usage:
    cp .env.example .env   # add your API key
    cd python
    python scripts/invoke_local.py
"""

import os
import sys


def _load_env(path: str = "../.env") -> None:
    """Minimal .env loader (no external deps)."""
    if not os.path.exists(path):
        # Also check for .env in python/ dir
        if os.path.exists(".env"):
            path = ".env"
        else:
            return
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            key, _, value = line.partition("=")
            os.environ.setdefault(key.strip(), value.strip())


def main() -> None:
    _load_env()

    # Add parent dir to path so `from src.handler` works
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from src.handler import handler

    print("Invoking Claude Metrics Lambda (Python) locally...\n")

    result = handler()

    if result["statusCode"] != 200:
        print(f"Error ({result['statusCode']}):", file=sys.stderr)
        print(result["body"], file=sys.stderr)
        sys.exit(1)

    print(result["body"])


if __name__ == "__main__":
    main()
