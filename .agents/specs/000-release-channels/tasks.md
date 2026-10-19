# Engineering tasks — Release channels: stable, beta, edge

**Not** a copy of a GitHub issue `- [ ]` acceptance checklist. This file tracks **which agent/chunk implements which technical piece**.

Source spec: [spec.md](./spec.md)  
Source plan: [plan.md](./plan.md)

Do not record chunk completion here.

## Chunks

| id | owner / agent | skill | key paths | verify command |
|----|---------------|-------|-----------|----------------|
| `chunk-a-ci-channels` | builder | git-workflow | `.github/workflows/`, `tools/publish-release-channel.mjs`, `tools/build-wegotworkspace-release.mjs` | `node --test tools/publish-release-channel.test.mjs tools/build-wegotworkspace-release.test.mjs` |
| `chunk-b-api-channel` | builder | api | `packages/api/app/Services/Update/`, `packages/api/app/Support/UpdateFeedDefaults.php` | `vendor/bin/phpunit tests/Feature/Admin/AdminUpdateChannelTest.php` |
| `chunk-c-admin-ui` | builder | apps-ui | `packages/apps/src/admin-core/src/` | `pnpm --dir packages/apps exec vitest run src/admin-core/src/admin-updates-pane.test.tsx` |
| `chunk-d-setup-channel` | builder | testing | `tools/setup-docker-install.sh` | `node --test tools/setup-docker-install.test.mjs` |

## Notes

- Chunk `id` values match `plan.md`.
