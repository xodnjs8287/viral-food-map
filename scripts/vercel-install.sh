#!/usr/bin/env bash
set -euo pipefail

if [ -d frontend ]; then
  cd frontend
fi

npm ci
