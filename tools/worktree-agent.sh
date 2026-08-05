#!/usr/bin/env bash
# Manage git worktrees for parallel agent chunks (multitask workflow).
#
#   tools/worktree-agent.sh create <chunk-id> [--type feat] [--base origin/main] [--port-offset N]
#   tools/worktree-agent.sh list
#   tools/worktree-agent.sh remove <chunk-id> [--force]
#
# Port conflicts: docs/dev-layout.md#multiple-worktrees-port-conflicts
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

main_worktree() {
  git -C "$ROOT" worktree list --porcelain | awk '/^worktree / { print substr($0, 10); exit }'
}

repo_basename() {
  basename "$(main_worktree)"
}

worktree_path_for() {
  local chunk_id="$1"
  local parent
  parent="$(dirname "$(main_worktree)")"
  echo "${parent}/$(repo_basename)-${chunk_id}"
}

branch_for() {
  echo "${1}/${2}"
}

validate_chunk_id() {
  local chunk_id="$1"
  if [[ ! "$chunk_id" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]]; then
    echo "error: invalid chunk-id '$chunk_id' (use lowercase letters, digits, hyphens)" >&2
    exit 1
  fi
}

usage() {
  cat <<EOF
usage:
  tools/worktree-agent.sh create <chunk-id> [--type feat] [--base origin/main] [--port-offset N]
  tools/worktree-agent.sh list
  tools/worktree-agent.sh remove <chunk-id> [--force]

Port conflicts: docs/dev-layout.md#multiple-worktrees-port-conflicts
EOF
  exit 1
}

write_env_local_ports() {
  local worktree_path="$1"
  local chunk_id="$2"
  local port_offset="$3"
  local dev_port=$((5173 + port_offset))
  local preview_port=$((4173 + port_offset))
  local env_file="${worktree_path}/.env.local"
  local marker="# worktree-agent: chunk ${chunk_id} (offset ${port_offset})"

  if [[ -f "$env_file" ]]; then
    local tmp
    tmp="$(mktemp)"
    awk -v marker="$marker" -v dev="$dev_port" -v preview="$preview_port" '
      BEGIN { wrote_marker=0; wrote_dev=0; wrote_preview=0 }
      $0 ~ /^# worktree-agent: chunk / { next }
      /^WGW_VITE_DEV_PORT=/ {
        if (!wrote_dev) { print marker; print "WGW_VITE_DEV_PORT=" dev; wrote_dev=1; wrote_marker=1 }
        next
      }
      /^WGW_VITE_PREVIEW_PORT=/ {
        if (!wrote_preview) { print "WGW_VITE_PREVIEW_PORT=" preview; wrote_preview=1 }
        next
      }
      { print }
      END {
        if (!wrote_marker) print marker
        if (!wrote_dev) print "WGW_VITE_DEV_PORT=" dev
        if (!wrote_preview) print "WGW_VITE_PREVIEW_PORT=" preview
      }
    ' "$env_file" >"$tmp"
    mv "$tmp" "$env_file"
  else
    cat >"$env_file" <<EOF
${marker}
WGW_VITE_DEV_PORT=${dev_port}
WGW_VITE_PREVIEW_PORT=${preview_port}
EOF
  fi
}

find_spec_hint() {
  local chunk_id="$1"
  local specs_root="${ROOT}/.agents/specs"
  local match=""

  if [[ -d "$specs_root" ]]; then
    match="$(grep -Rl --include='tasks.md' -E "(^|[[:space:]|])${chunk_id}([[:space:]|]|$)" "$specs_root" 2>/dev/null | head -1 || true)"
    if [[ -n "$match" ]]; then
      dirname "$match" | sed "s|^${ROOT}/||"
      return 0
    fi
    match="$(find "$specs_root" -mindepth 1 -maxdepth 1 -type d -name "*-${chunk_id}" 2>/dev/null | head -1 || true)"
    if [[ -n "$match" ]]; then
      echo "$match" | sed "s|^${ROOT}/||"
      return 0
    fi
  fi

  echo ".agents/specs/*-${chunk_id}/ (create from plan tasks.md if missing)"
}

cmd_create() {
  local chunk_id="${1:-}"
  shift || true
  local branch_type="feat"
  local base="origin/main"
  local port_offset=1

  [[ -n "$chunk_id" ]] || usage
  validate_chunk_id "$chunk_id"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --type)
        branch_type="${2:-}"
        shift 2
        ;;
      --base)
        base="${2:-}"
        shift 2
        ;;
      --port-offset)
        port_offset="${2:-}"
        shift 2
        ;;
      *)
        echo "error: unknown option '$1'" >&2
        usage
        ;;
    esac
  done

  if [[ ! "$port_offset" =~ ^[0-9]+$ ]]; then
    echo "error: --port-offset must be a non-negative integer" >&2
    exit 1
  fi

  local branch worktree_path dev_port preview_port spec_hint
  branch="$(branch_for "$branch_type" "$chunk_id")"
  worktree_path="$(worktree_path_for "$chunk_id")"
  dev_port=$((5173 + port_offset))
  preview_port=$((4173 + port_offset))
  spec_hint="$(find_spec_hint "$chunk_id")"

  if [[ -e "$worktree_path" ]]; then
    echo "error: worktree path already exists: $worktree_path" >&2
    echo "hint: use 'tools/worktree-agent.sh list' or pick another chunk-id / remove the existing worktree" >&2
    exit 1
  fi

  if git -C "$ROOT" show-ref --verify --quiet "refs/heads/${branch}"; then
    echo "error: branch already exists: $branch" >&2
    exit 1
  fi

  echo "Fetching ${base}..."
  git -C "$ROOT" fetch origin

  echo "Creating worktree at $worktree_path (branch $branch from $base)..."
  git -C "$ROOT" worktree add -b "$branch" "$worktree_path" "$base"

  write_env_local_ports "$worktree_path" "$chunk_id" "$port_offset"

  cat <<EOF

Worktree ready — handoff
------------------------
Branch:       ${branch}
Path:         ${worktree_path}
Spec:         ${spec_hint}
Tasks:        grep '${chunk_id}' in tasks.md for chunk row
Ports:        dev :${dev_port}, preview :${preview_port} (.env.local written)
Port docs:    docs/dev-layout.md#multiple-worktrees-port-conflicts

Next:
  cd ${worktree_path}
  pnpm install   # if node_modules not yet present in this worktree
  pnpm dev       # uses WGW_VITE_DEV_PORT / WGW_VITE_PREVIEW_PORT from .env.local
EOF
}

cmd_list() {
  local repo_name chunk_glob
  repo_name="$(repo_basename)"
  chunk_glob="$(dirname "$(main_worktree)")/${repo_name}-*"

  echo "Agent worktrees (pattern: ${repo_name}-<chunk-id>):"
  echo

  local listed=0
  while IFS= read -r line; do
    [[ "$line" == worktree* ]] || continue
    local path="${line#worktree }"
    local base
    base="$(basename "$path")"
    if [[ "$base" == "${repo_name}-"* ]]; then
      listed=1
      local chunk_id="${base#${repo_name}-}"
      local branch=""
      if IFS= read -r branch_line && [[ "$branch_line" == branch* ]]; then
        branch="${branch_line#branch }"
      fi
      printf '  %-28s  %s\n' "$chunk_id" "$path"
      [[ -n "$branch" ]] && printf '  %-28s  branch %s\n' "" "$branch"
    fi
  done < <(git -C "$ROOT" worktree list --porcelain)

  if [[ "$listed" -eq 0 ]]; then
    echo "  (none)"
    echo
    echo "Create one: tools/worktree-agent.sh create <chunk-id>"
  fi
}

find_worktree_path_by_chunk() {
  local chunk_id="$1"
  local expected
  expected="$(worktree_path_for "$chunk_id")"

  if git -C "$ROOT" worktree list --porcelain | awk -v p="$expected" '/^worktree / { if (substr($0, 10) == p) found=1 } END { exit !found }'; then
    echo "$expected"
    return 0
  fi

  echo "error: no agent worktree found for chunk-id '$chunk_id' (expected $expected)" >&2
  exit 1
}

cmd_remove() {
  local chunk_id="${1:-}"
  shift || true
  local force=0

  [[ -n "$chunk_id" ]] || usage
  validate_chunk_id "$chunk_id"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --force)
        force=1
        shift
        ;;
      *)
        echo "error: unknown option '$1'" >&2
        usage
        ;;
    esac
  done

  local worktree_path branch
  worktree_path="$(find_worktree_path_by_chunk "$chunk_id")"
  branch="$(git -C "$worktree_path" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"

  local remove_args=()
  if [[ "$force" -eq 1 ]]; then
    remove_args+=(--force)
  fi

  echo "Removing worktree: $worktree_path"
  git -C "$ROOT" worktree remove "${remove_args[@]}" "$worktree_path"

  if [[ -z "$branch" || "$branch" == "HEAD" ]]; then
    return 0
  fi

  if git -C "$ROOT" show-ref --verify --quiet "refs/heads/${branch}"; then
    if git -C "$ROOT" merge-base --is-ancestor "$branch" origin/main 2>/dev/null; then
      echo "Deleting merged branch: $branch"
      git -C "$ROOT" branch -d "$branch"
    elif [[ "$force" -eq 1 ]]; then
      echo "warning: deleting unmerged branch (--force): $branch"
      git -C "$ROOT" branch -D "$branch"
    else
      echo "Keeping branch $branch (not merged into origin/main; use --force to delete)"
    fi
  fi
}

main() {
  local cmd="${1:-}"
  shift || true

  case "$cmd" in
    create)
      cmd_create "$@"
      ;;
    list)
      [[ $# -eq 0 ]] || usage
      cmd_list
      ;;
    remove)
      cmd_remove "$@"
      ;;
    -h | --help | help | "")
      usage
      ;;
    *)
      echo "error: unknown command '$cmd'" >&2
      usage
      ;;
  esac
}

main "$@"
