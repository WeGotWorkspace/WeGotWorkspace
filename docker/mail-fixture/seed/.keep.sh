#!/bin/sh
set -eu
for user in bob@example.test alice@example.test; do
  mkdir -p "/seed/${user}/cur" "/seed/${user}/tmp"
done
