#!/usr/bin/env sh
# node --test, but a named path that matches no file is an error.
# Node treats positional arguments as globs. A glob that matches nothing
# is not a failure, and a missing file among present ones still exits 0.
set -eu

if [ "$#" -eq 0 ]; then
  echo "node-test: no test files given" >&2
  exit 1
fi

for f in "$@"; do
  [ -f "$f" ] || {
    echo "node-test: missing test file: $f" >&2
    exit 1
  }
done

exec node --test "$@"
