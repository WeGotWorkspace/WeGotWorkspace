# Engineering tasks — Drive guest / link sharing access UI

**Not** a copy of the GitHub issue `- [ ]` acceptance checklist. Tracks technical pieces delivered / remaining on `feat/drive-share-access-ui`.

Source spec: [spec.md](./spec.md)  
Source plan: [plan.md](./plan.md)

## Chunks

| id | owner / agent | skill | key paths | verify command | status |
|----|---------------|-------|-----------|----------------|--------|
| `chunk-share-api-client` | builder | api / apps-ui | `packages/apps/src/lib/api/wgw/drive-shares.ts`, `packages/apps/src/lib/api/mock/drive-share-*` | `pnpm --dir packages/apps exec vitest run src/lib/api` | done |
| `chunk-share-ui-dialog` | builder | apps-ui | `packages/apps/src/share-ui/**` | Storybook + share-ui Vitest | done |
| `chunk-workspace-wiring` | builder | workspace | `packages/apps/src/drive-core/**`, `packages/apps/src/docs-core/**` | `pnpm test:apps-done-gate` | done |
| `chunk-guest-public` | builder | workspace | share public route, `packages/apps/src/lib/api/wgw/drive.ts` guest state | guest routing tests | done |
| `chunk-access-manager` | builder | workspace | `drive-access-*`, `docs-collab-permissions` | access + collab tests | done |
| `chunk-verify` | verifier | testing | typecheck fixes + `.agents/specs/311-drive-share-access-ui/` | `pnpm test:apps-done-gate` | in progress |

## Notes

- Expiry (Goal #388) is **out of scope** for this branch — track as follow-up; do not mark Goal done solely from this PR.
- Leave rate-limiting WIP unstaged; do not fold into share-access commits.
- On scope change: update issue #311 first, then re-sync spec/plan/tasks and the `Source:` body-hash.
