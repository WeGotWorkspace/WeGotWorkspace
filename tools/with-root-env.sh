#!/usr/bin/env bash
# Load repo-root .env (with shell expansion) then run a command.
#
#   tools/with-root-env.sh -- turbo run test
#   tools/with-root-env.sh run 'pnpm run dev:bootstrap && turbo run dev'
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

# Vite worktree port lives in `.env.local` (not Laravel's packages/api/.env). Export it so
# the API can build public SPA URLs (reset mail, /logout) instead of http://127.0.0.1:9080.
if [[ -f .env.local ]]; then
  # `|| true`: grep exits 1 when the key is absent; pipefail would abort the script.
  vite_port="$(grep -E '^WGW_VITE_DEV_PORT=' .env.local | tail -n 1 | cut -d= -f2- | tr -d "\"'" || true)"
  if [[ -n "${vite_port}" ]]; then
    export WGW_VITE_DEV_PORT="${vite_port}"
  fi
  public_web="$(grep -E '^WGW_PUBLIC_WEB_URL=' .env.local | tail -n 1 | cut -d= -f2- | tr -d "\"'" || true)"
  if [[ -n "${public_web}" ]]; then
    export WGW_PUBLIC_WEB_URL="${public_web}"
  fi
fi

usage() {
  echo "usage: tools/with-root-env.sh -- <command> [args...]" >&2
  echo "       tools/with-root-env.sh run '<shell pipeline>'" >&2
  exit 1
}

[[ $# -gt 0 ]] || usage

if [[ "${1:-}" == "run" ]]; then
  shift
  [[ $# -gt 0 ]] || usage
  bash -ec "$*"
  exit 0
fi

if [[ "${1:-}" == "--" ]]; then
  shift
fi

[[ $# -gt 0 ]] || usage
exec "$@"
