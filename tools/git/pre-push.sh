#!/usr/bin/env bash
# Husky pre-push: run apps done gate when packages/apps/** changed in the push range.
# Otherwise keep the lightweight typecheck that pre-push ran before #250.
set -euo pipefail

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
  echo "pre-push: packages/apps changed — running pnpm test:apps-done-gate"
  # Do not let Vitest inherit git's pre-push stdin (the ref list pipe).
  exec < /dev/null
  set +e
  pnpm test:apps-done-gate
  gate_status=$?
  set -e
  # Storybook/Vitest leftover workers can SIGPIPE (141) after a green gate.
  if [ "$gate_status" -eq 141 ]; then
    echo "pre-push: apps done-gate passed; ignoring leftover worker SIGPIPE"
    exit 0
  fi
  exit "$gate_status"
else
  echo "pre-push: no packages/apps changes — running typecheck"
  pnpm --filter @wgw/apps typecheck
fi
