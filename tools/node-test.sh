#!/usr/bin/env sh
# node --test, but a named path that matches no file is an error.
# Node treats positional arguments as globs. A glob that matches nothing
# is not a failure, and a missing file among present ones still exits 0
# on Node 22 and Node 24.
#
# Arguments that start with "-" are passed through, for example
# --test-reporter=tap. Every other argument must be an existing file.
# Directories and glob patterns are rejected: a pattern that matches
# nothing is the failure this script exists to catch.
set -eu

file_count=0
for f in "$@"; do
  case $f in
    -*) continue ;;
  esac
  file_count=$((file_count + 1))
  [ -f "$f" ] || {
    echo "node-test: missing test file: $f" >&2
    exit 1
  }
done

if [ "$file_count" -eq 0 ]; then
  echo "node-test: no test files given" >&2
  exit 1
fi

exec node --test "$@"
