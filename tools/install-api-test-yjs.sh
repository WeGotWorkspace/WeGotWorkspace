#!/usr/bin/env bash
# CollabDocumentEndpointsTest encodes a large update by importing
# packages/apps/node_modules/yjs/dist/yjs.mjs. api-quality installs the JS
# workspace. The MySQL and coverage jobs do not, so place that one package
# on the path the test already imports.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
target="$root/packages/apps/node_modules/yjs/dist/yjs.mjs"
if [[ -f "$target" ]]; then
  exit 0
fi

spec=$(node -p "require('$root/packages/apps/package.json').dependencies.yjs")
dest="${RUNNER_TEMP:-$(mktemp -d)}/wgw-api-test-yjs"
rm -rf "$dest"
mkdir -p "$dest"
npm install --ignore-scripts --prefix "$dest" "yjs@${spec}"
mkdir -p "$root/packages/apps/node_modules"
ln -sfn "$dest/node_modules/yjs" "$root/packages/apps/node_modules/yjs"
test -f "$target"
