# Engineering tasks — Teams: rename Groups, and see only colleagues you share a Team with

**Not** a copy of the GitHub issue `- [ ]` acceptance checklist. This file tracks **which agent/chunk implements which technical piece** for multitask and worktree handoffs.

Source spec: [spec.md](./spec.md)  
Source plan: [plan.md](./plan.md)

Do not record chunk completion here. The GitHub issue and the test or file that proves the claim are the record.

## Chunks

| id | owner / agent | skill | key paths | verify command |
|----|---------------|-------|-----------|----------------|
| `team-rename-copy` | builder | apps-ui | `packages/apps/src/admin-core/`, `settings-core/`, `*-labels.ts`, `drive-core/src/drive-path-utils.ts`, `ui/owner-scope-labels.ts`, `packages/api/app/Mcp/Tools/`, e2e specs | `pnpm --dir packages/apps exec vitest run` |
| `admin-role` | builder | api, apps-ui | `app/Services/Auth/AdminRoleResolver.php`, `app/Services/Admin/`, `app/Services/Installer/InstallerSeeder.php`, `database/migrations/wgw/`, `packages/apps/src/admin-core/` | `composer --working-dir packages/api done-gate` |
| `colleague-resolver` | builder | api | `packages/api/app/Services/Teams/TeamColleagues.php` (new), `tests/Feature/Teams/` | `composer --working-dir packages/api done-gate` |
| `people-directory-filter` | builder | api | `app/Services/Calendars/CalendarSchedulingNotificationService.php`, `app/Services/Drive/DriveSharePrincipalDirectoryService.php`, `openapi/openapi.json` | `composer --working-dir packages/api done-gate` |
| `interaction-gates` | builder | api, security | `app/Services/Chat/ChatChannelRepository.php`, `app/Services/Calendars/CalendarShareInvites.php`, `app/Services/Contacts/AddressBookShareInvites.php`, `app/Services/Drive/DriveShareShareeCheck.php`, `app/Mcp/McpMemberShareCommand.php` | `composer --working-dir packages/api done-gate` |
| `hide-shares-caldav-carddav` | builder | api | `app/Services/Calendars/CalendarShareVisibility.php`, `app/Dav/Server/WgwCalendarBackend.php`, `app/Services/Contacts/AddressBookShareVisibility.php`, `app/Services/Contacts/AddressBookCollectionAccess.php`, `app/Services/Calendars/CalendarShareInvites.php` | `composer --working-dir packages/api done-gate` |
| `hide-shares-drive-docs` | builder | api | `app/Services/Drive/DriveShareGrantResolver.php`, `app/Services/Drive/DriveShareService.php`, `app/Services/Drive/DriveShareGrantWriter.php`, `app/Services/Collab/` | `composer --working-dir packages/api done-gate && pnpm test:collab-api` |
| `presence-team-rooms` | builder | api, apps-ui | `app/Services/Principal/PrincipalRoomAuthorizer.php`, `packages/apps/src/presence-core/src/` | `pnpm --dir packages/apps exec vitest run src/presence-core` |
| `dav-group-directory` | builder | api, security | `app/Dav/Server/GroupPrincipalContainer.php`, `app/Dav/Server/GroupMemberPrincipal.php`, `app/Dav/Server/AppCalDAVPrincipalCollection.php` | `composer --working-dir packages/api done-gate` |
| `scheduling-as-guest` | builder | api, security | `app/Services/Calendars/CalendarSchedulingService.php`, `app/Dav/Server/CalendarScheduleDeliveryGuardPlugin.php`, `app/Dav/Server/WgwSchedulePlugin.php` (new), `app/Dav/SabreServerFactory.php` | `composer --working-dir packages/api done-gate` |
| `no-team-empty-states` | builder | apps-ui | `packages/apps/src/meet-core/`, `calendar-core/`, `share-ui/`, `settings-core/src/settings-memberships-pane.tsx` | `pnpm --dir packages/apps exec vitest run` |
| `teams-visibility-verify` | verifier | testing | read-only | done-checklist + own browser e2e |

## Issues

A #1916 · B #1917 · C #1918 · D #1919 · E1 #1920 · E2 #1926 · F #1921 · G #1922 · H #1923 · I #1924 · J #1925

## Notes

- Order: A, B, J in parallel; then C, D, F, H; E1 on top of D; E2 after E1; G after H; I after C and H.

- Chunk `id` values must match `plan.md` chunk IDs and multitask handoff names.
- `team-rename-copy`, `admin-role` and `no-team-empty-states` are visible UI: they wait for the product owner's review before merge.
- On scope change: update the **issue first**, then re-sync spec/plan/tasks and the `Source:` body-hash in spec.md.
