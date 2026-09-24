#!/usr/bin/env bash
# Delete wegotworkspace-candidate versions older than 7 days.
# Published releases do not depend on these tags: imagetools copies blobs
# into ghcr.io/wegotworkspace/wegotworkspace.
set -euo pipefail

PACKAGE="${WGW_GHCR_CANDIDATE_PACKAGE:-wegotworkspace-candidate}"
ORG="${WGW_GHCR_ORG:-WeGotWorkspace}"
DAYS="${WGW_GHCR_CANDIDATE_MAX_AGE_DAYS:-7}"
CUTOFF="$(date -u -d "${DAYS} days ago" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -v-"${DAYS}"d +%Y-%m-%dT%H:%M:%SZ)"

echo "Deleting ${ORG}/${PACKAGE} versions created before ${CUTOFF}"

gh api --paginate "/orgs/${ORG}/packages/container/${PACKAGE}/versions" --jq '.[] | [.id, .created_at, (.metadata.container.tags | join(","))] | @tsv' |
  while IFS=$'\t' read -r id created tags; do
    if [[ "$created" < "$CUTOFF" ]]; then
      echo "delete ${id} created ${created} tags ${tags}"
      gh api --method DELETE "/orgs/${ORG}/packages/container/${PACKAGE}/versions/${id}"
    fi
  done
