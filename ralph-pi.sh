#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ ! -d "$SCRIPT_DIR/node_modules" ]]; then
  echo "Installing dependencies..."
  (cd "$SCRIPT_DIR" && npm install)
fi

cd "$SCRIPT_DIR"
npm run start -- "$@"
