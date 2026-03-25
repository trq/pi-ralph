#!/usr/bin/env bash
set -euo pipefail

SOURCE="${BASH_SOURCE[0]}"
while [[ -L "$SOURCE" ]]; do
  DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"
  LINK_TARGET="$(readlink "$SOURCE")"
  if [[ "$LINK_TARGET" != /* ]]; then
    SOURCE="$DIR/$LINK_TARGET"
  else
    SOURCE="$LINK_TARGET"
  fi
done

SCRIPT_DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"

if [[ ! -f "$SCRIPT_DIR/package.json" ]]; then
  echo "Could not find package.json in Ralph directory: $SCRIPT_DIR" >&2
  exit 1
fi

if [[ ! -d "$SCRIPT_DIR/node_modules" ]]; then
  echo "Installing Ralph dependencies..."
  (cd "$SCRIPT_DIR" && npm install)
fi

if [[ "${1:-}" == "plan-lint" ]]; then
  shift
  exec "$SCRIPT_DIR/node_modules/.bin/tsx" "$SCRIPT_DIR/src/plan-lint.ts" "$@"
fi

exec "$SCRIPT_DIR/node_modules/.bin/tsx" "$SCRIPT_DIR/src/ralph-loop.ts" "$@"
