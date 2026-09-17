#!/usr/bin/env bash
# Husky pre-push: run apps done gate when packages/apps/** changed in the push range.
# Otherwise keep the lightweight typecheck that pre-push ran before #250.
set -euo pipefail
# Leftover Vitest/Storybook workers can SIGPIPE the hook after a green gate.
trap '' PIPE

apps_changed=0
had_ref=0

while read -r local_ref local_sha remote_ref remote_sha; do
  [ -z "${local_sha:-}" ] && continue
  had_ref=1

  if [ "$local_sha" = "0000000000000000000000000000000000000000" ]; then
    continue
  fi

  if [ "$remote_sha" = "0000000000000000000000000000000000000000" ]; then
    if git rev-parse --verify origin/main >/dev/null 2>&1; then
      base="$(git merge-base origin/main "$local_sha")"
    elif git rev-parse --verify main >/dev/null 2>&1; then
      base="$(git merge-base main "$local_sha")"
    else
      base="$(git hash-object -t tree /dev/null)"
    fi
    range="${base}..${local_sha}"
  else
    range="${remote_sha}..${local_sha}"
  fi

  if git diff --name-only "$range" | grep -q '^packages/apps/'; then
    apps_changed=1
    break
  fi
done

# Manual invocation (no stdin): compare HEAD to upstream or origin/main.
if [ "$had_ref" -eq 0 ]; then
  if upstream="$(git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null)"; then
    if git diff --name-only "${upstream}..HEAD" | grep -q '^packages/apps/'; then
      apps_changed=1
    fi
  elif git diff --name-only origin/main..HEAD 2>/dev/null | grep -q '^packages/apps/'; then
    apps_changed=1
  fi
fi

if [ "$apps_changed" -eq 1 ]; then
  gate_log="$(mktemp -t wgw-apps-done-gate.XXXXXX)"
  echo "pre-push: packages/apps changed — running pnpm test:apps-done-gate"
  echo "pre-push: log ${gate_log}"
  # Vitest must not inherit git's pre-push stdin (the ref list). Gate logs must
  # not stream on the hook pipe — ~128KB fills it and git dies with SIGPIPE.
  exec < /dev/null
  set +e
  pnpm test:apps-done-gate >"${gate_log}" 2>&1
  gate_status=$?
  set -e
  if [ "$gate_status" -ne 0 ] && [ "$gate_status" -ne 141 ]; then
    tail -n 40 "${gate_log}" >&2 || true
    exit "$gate_status"
  fi
  echo "pre-push: apps done-gate passed"
  exit 0
else
  echo "pre-push: no packages/apps changes — running typecheck"
  pnpm --filter @wgw/apps typecheck
fi
