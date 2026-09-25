#!/usr/bin/env bash
# Same scan the gitleaks-action runs (v8.24.3), without its organization license gate.
# Dependabot workflows cannot read Actions secrets, so GITLEAKS_LICENSE is empty there.
set -euo pipefail

VERSION="8.24.3"
ARCHIVE="gitleaks_${VERSION}_linux_x64.tar.gz"
URL="https://github.com/zricethezav/gitleaks/releases/download/v${VERSION}/${ARCHIVE}"

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT
curl -sSfL "$URL" -o "${tmpdir}/${ARCHIVE}"
tar -xzf "${tmpdir}/${ARCHIVE}" -C "$tmpdir"
install -m 0755 "${tmpdir}/gitleaks" /usr/local/bin/gitleaks

args=(
  detect
  --redact
  -v
  --exit-code=2
  --report-format=sarif
  --report-path=results.sarif
  --log-level=debug
)

event="${GITHUB_EVENT_NAME:-}"
event_path="${GITHUB_EVENT_PATH:-}"

if [[ "$event" == "pull_request" ]]; then
  base="$(jq -r '.pull_request.base.sha' "$event_path")"
  head="$(jq -r '.pull_request.head.sha' "$event_path")"
  first="$(git rev-list --reverse "${base}..${head}" | head -n 1)"
  if [[ -z "$first" ]]; then
    echo "No commits to scan"
    exit 0
  fi
  args+=("--log-opts=--no-merges --first-parent ${first}^..${head}")
elif [[ "$event" == "push" ]]; then
  count="$(jq '.commits | length' "$event_path")"
  if [[ "$count" == "0" ]]; then
    echo "No commits to scan"
    exit 0
  fi
  first="$(jq -r '.commits[0].id' "$event_path")"
  last="$(jq -r '.commits[-1].id' "$event_path")"
  if [[ "$first" == "$last" ]]; then
    args+=("--log-opts=-1")
  else
    args+=("--log-opts=--no-merges --first-parent ${first}^..${last}")
  fi
fi

echo "gitleaks ${args[*]}"
set +e
gitleaks "${args[@]}"
code=$?
set -e
if [[ "$code" -eq 2 ]]; then
  echo "::error::Gitleaks detected secrets"
  exit 1
fi
exit "$code"
