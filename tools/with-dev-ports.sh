#!/usr/bin/env bash
# Allocate free Vite / Storybook / PHP ports, then run a command with them exported.
#
#   tools/with-root-env.sh -- tools/with-dev-ports.sh turbo run dev --filter=@wgw/api
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

eval "$(node "$ROOT/tools/allocate-dev-ports.mjs")"

[[ $# -gt 0 ]] || {
  echo "usage: tools/with-dev-ports.sh <command> [args...]" >&2
  exit 1
}

exec "$@"
