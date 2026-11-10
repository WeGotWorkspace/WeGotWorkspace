# Engineering tasks — One shared label base (#1641 step b)

Source spec: [spec.md](./spec.md)  
Source plan: [plan.md](./plan.md)

Do not record chunk completion here. The GitHub issue and the test or file that proves the claim are the record.

## Chunks

| id | owner / agent | skill | key paths | verify command |
|----|---------------|-------|-----------|----------------|
| `chunk-a-snapshot` | builder | testing | `packages/apps/src/lib/workspace/workspace-labels.snapshot.test.ts` | `pnpm --dir packages/apps exec vitest run --project unit src/lib/workspace` |
| `chunk-b-base` | builder | apps-ui | `packages/apps/src/lib/workspace/workspace-labels.ts`, `destructive-dialog.ts` | same + `pnpm --dir packages/apps run typecheck` |
| `chunk-c-notes` | builder | apps-ui | `packages/apps/src/notes-core/src/notes-labels.ts` | same |
| `chunk-c-contacts` | builder | apps-ui | `packages/apps/src/contacts-core/src/contacts-labels.ts` | same |
| `chunk-c-tasks` | builder | apps-ui | `packages/apps/src/tasks-core/src/tasks-labels.ts` | same |
| `chunk-c-calendar` | builder | apps-ui | `packages/apps/src/calendar-core/src/calendar-labels.ts` | same |
| `chunk-c-docs` | builder | apps-ui | `packages/apps/src/docs-core/src/docs-labels.ts` | same |
| `chunk-c-drive` | builder | apps-ui | `packages/apps/src/drive-core/src/drive-*labels.ts` | same |
| `chunk-c-meet` | builder | apps-ui | `packages/apps/src/meet-core/src/meet-labels.ts` | same |
| `chunk-c-chat` | builder | apps-ui | `packages/apps/src/chat-ui/src/chat-labels.ts` | same |
| `chunk-c-share` | builder | apps-ui | `packages/apps/src/share-ui/share-labels.ts`, `packages/apps/src/ui/owner-scope-labels.ts` | same |
| `chunk-d-docs` | builder | document | `.agents/skills/workspace/feature-blueprint.md` | `pnpm run check:agent-docs` |

## Snapshotted exports

`defaultNotesLabels`, `defaultContactsLabels`, `defaultTasksLabels`, `defaultCalendarLabels`, `docsLabels`, `docsPageSetupLabels`, `driveLabels`, `driveUploadBatchLabels`, `driveUploadIssueLabels`, `meetLabels`, `chatUiLabels`, `shareLabels`, `sharePermissionLabels`, `noTeamYetCopy`, `noPeopleOrTeamsFoundCopy`, `defaultOwnerScopeLabels`, `MCP_SCOPE_CATALOG`, `workspaceDestructiveDialogLabels`.

## Notes

- Chunk `id` values match `plan.md`.
- On scope change: update the issue first, then re-sync these files and the `Source:` body-hash.
