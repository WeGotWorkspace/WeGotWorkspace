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

# Vite / Storybook / PHP worktree ports live in `.env.local` (not Laravel's packages/api/.env).
# Export them so a second `pnpm dev` can pin ports, and so the API can build SPA URLs.
if [[ -f .env.local ]]; then
  export_env_local_key() {
    local key="$1"
    # `|| true`: grep exits 1 when the key is absent; pipefail would abort the script.
    local value
    value="$(grep -E "^${key}=" .env.local | tail -n 1 | cut -d= -f2- | tr -d "\"'" || true)"
    if [[ -n "${value}" ]]; then
      export "${key}=${value}"
    fi
  }
  export_env_local_key WGW_VITE_DEV_PORT
  export_env_local_key WGW_VITE_PREVIEW_PORT
  export_env_local_key WGW_STORYBOOK_PORT
  export_env_local_key WGW_PHP_DEV_PORT
  export_env_local_key WGW_PUBLIC_WEB_URL
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
