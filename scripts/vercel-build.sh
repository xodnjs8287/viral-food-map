#!/usr/bin/env bash
set -euo pipefail

if [ -d frontend ]; then
  cd frontend
  npm run build
  cd ..
  rm -rf .next
  cp -R frontend/.next .next
else
  npm run build
fi

cp .next/routes-manifest.json .next/routes-manifest-deterministic.json
