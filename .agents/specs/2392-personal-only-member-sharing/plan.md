# Per-member sharing only on personal collections

Derived from [spec.md](./spec.md). Chunk layout for separate PRs.

## Goal

Team-owned collections (and Project collections) get access through Team membership only. The API refuses per-person grants on them for every app and entry point, a migration removes the existing ones, moving a personal collection into a Team drops its grants, and the UI hides the per-person section and warns before the move. Personal collections keep per-person sharing.

## Budget

Draws from the Teams visibility work (Epic #1915 share gate) and Goal Product#155; displaces nothing else. It reuses the existing `TeamColleagues` share gate and does not add a new permission system.

## Non-goals

- Drive per-document access, guests, external people, team-admin definition.
- A viewer role in Teams.
- Availability settings (stay personal).
- Notifying revoked people (decided: no, D6).

## What exists

- All grants for Calendar, Tasks, Notes and chat channels go through one method. `path: packages/api/app/Services/Calendars/CalendarShareInvites.php:85`
- Contacts has its own method with the same shape and the same Team gate. `path: packages/api/app/Services/Contacts/AddressBookShareInvites.php:58`
- DAV sharing enters through a Sabre plugin that already applies the Team gate; it is a third entry point. `path: packages/api/app/Dav/Server/TeamGatedSharingPlugin.php:33`
- The Team gate (who a caller may share with) is one method both paths use. `path: packages/api/app/Services/Teams/TeamColleagues.php:100`
- Team members and personal owners both sit on `SHAREDOWNER`, so `canShare` does not tell Team-owned from personal. `path: packages/api/app/Services/Calendars/CalendarShareInvites.php:27`
- Grants are extra `calendarinstances` rows on the same `calendarid` (owner row `access` 1, grantees 2 or 3). `path: packages/api/app/Services/Calendars/CalendarShareInvites.php:50`
- Address-book grants are `addressbook_shares` rows. `path: packages/api/database/migrations/wgw/2026_08_31_000330_wgw_create_addressbook_shares.php:13`
- Owner move exists for calendars, task lists, notebooks and chat channels and changes only `principaluri`; grants are left alone. `path: packages/api/app/Services/Tasks/TaskListRepository.php:301`
- Calendar owner move and its team-admin check. `path: packages/api/app/Services/Calendars/CalendarRepository.php:450`
- Chat channel owner move. `path: packages/api/app/Services/Chat/ChatChannelRepository.php:499`
- Notebook owner move. `path: packages/api/app/Services/Notes/NotebookRepository.php:389`
- Moving in or out of a Team needs a team admin. `path: packages/api/app/Services/Calendars/CalendarCollectionAccess.php:221`
- Address books have no owner move and no `groupSlug` handling in the repository. `path: packages/api/app/Services/Contacts/AddressBookRepository.php:74` (the only share code is `shareInvites->apply`; the file has no `groupSlug` or `transferOwner`)
- Project collections are created under the Team principal by a service that bypasses client guards. `path: packages/api/app/Services/Projects/ProjectCollections.php:29`
- Today the Project default collection is only locked in the UI; the API accepts `shareWith` on it. `path: packages/apps/src/calendar-core/src/calendar-collection-write.ts:16`
- The shared share section is used by Calendar, Contacts, Meet, Project dialog (Tasks and Notes). `path: packages/apps/src/share-ui/collection-share-section.tsx:57`
- The section's title is the label "Team access", although it lists single people. `path: packages/apps/src/lib/workspace/workspace-labels.ts:92`
- The owner-move confirm dialog exists in the Calendar dialog; the Project and Meet dialogs have their own owner-change flow. `path: packages/apps/src/calendar-core/src/calendar-calendar-dialog.tsx:373`
- Single-task move between lists resolves the target list only by write access. `path: packages/api/app/Services/Tasks/TaskRepository.php:516`
- Event move to another calendar goes through the patch target calendar. `path: packages/api/app/Services/Calendars/CalendarEventMutationSupport.php:416`
- Issue status: Epic #2392 open, parent Goal Product#155. `path: .agents/specs/2392-personal-only-member-sharing/spec.md:1` (Source line; `gh issue view 2392` on 2026-11-26)

## Considered

Considered: the existing `CalendarShareInvites::apply` / `AddressBookShareInvites::apply` choke points, per-repository checks, and a database trigger.
- One shared rule helper called from both `apply` methods and the DAV plugin — **chosen**: every app and entry point is covered by three call sites, and a new app cannot forget it.
- A check in each repository's `update()` — rejected: five copies, and JMAP/MCP/DAV bypass some of them.
- Hide the UI section only — rejected by the product lead: a member could still share through the API, DAV or MCP.
- Re-use `myRights.mayShare = false` on Team collections to drive the UI — rejected: Team members sit on `SHAREDOWNER` and `mayShare` gates other behaviour; the UI uses `groupSlug` instead.
- Convert per-person grants into Team membership on a move — rejected: grants could belong to people outside the Team, which is the leak this Epic closes.
- Keep grants when moving into a Team and only block new ones — rejected: the Epic says the move drops them, and kept grants would survive the person leaving the Team.
- Soft-hide old grants instead of a deleting migration — rejected: pre-beta, breaking is fine; hidden rows would come back if the rule changed.

## Affected packages

- packages/api
- packages/apps
- docs

## Dependencies

1. `api-rule` first (the helper and the refusal).
2. `api-move` and `migration` after `api-rule` (they use the same Team-owned test). They can be built in parallel with each other.
3. `ui-hide-section` after `api-rule` (so a hidden section never hides a still-open API hole); it does not need the move or migration.
4. `ui-move-confirm` after `api-move`.
5. `per-app-check` last, after everything is merged on one branch.

## Open decisions

None — every choice is made. The product lead accepted all proposals on 2026-11-26 (D1 to D7 in [spec.md](./spec.md#decisions-product-lead-2026-11-26)).

## Invariants

- Personal collections can still be shared with single people in every app. A wrong rule (owner test inverted or too broad) blocks all sharing. Proof: `cmd: cd packages/api && php artisan test --filter=PersonalCollectionShareStillWorks`
- Revoking a grant on a Team-owned collection still works. A wrong rule that refuses every `shareWith` patch would leave leftovers unremovable. Proof: `cmd: cd packages/api && php artisan test --filter=TeamOwnedShareRevokeAllowed`
- Team members keep access to Team collections after grants are removed. A wrong delete (by `calendarid` instead of by grantee rows) would remove the owner row. Proof: `cmd: cd packages/api && php artisan test --filter=TeamMigrationKeepsTeamAccess`
- Chat DMs (personal, share through `apply`) and Project creation (bypasses client guards) still work. A rule placed in the wrong layer would break DM creation or Project creation. Proof: `cmd: cd packages/api && php artisan test --filter=ChatDirectMessage` and `--filter=ProjectCreate`
- Owner move without grants (Team to Team, Team to personal, personal without grants to Team) is unchanged. A wrong delete in `transferOwner` would error or drop Team rows. Proof: `cmd: cd packages/api && php artisan test --filter=OwnerTransfer`
- After `api-rule` alone, main still works: the UI still shows the section and the API answers a clear 403. Proof: `cmd: pnpm --dir packages/apps exec vitest run src/calendar-core/src/calendar-calendar-dialog.test.tsx`
- The migration is idempotent: a second run changes nothing. Proof: `cmd: cd packages/api && php artisan test --filter=RemoveTeamMemberSharesMigration`

## Chunks

### Chunk A: API refuses per-person grants on Team-owned collections

- **id:** `api-rule`
- **Skill:** api
- **Inputs:** one `apply` per grant store — `path: packages/api/app/Services/Calendars/CalendarShareInvites.php:85`; `path: packages/api/app/Services/Contacts/AddressBookShareInvites.php:58`; DAV plugin — `path: packages/api/app/Dav/Server/TeamGatedSharingPlugin.php:33`
- **Done when:** a shared helper decides "Team-owned" from the owner principal (`GROUP_PREFIX`) and refuses user-principal grants with 403 `forbidden`; both `apply` methods and the DAV plugin call it; `create()` with `shareWith` on a Team-owned collection is refused; revoke stays allowed; Project default collections are covered (no extra code, they are Team-owned); REST, JMAP (`CalendarSet`, `AddressBookSet`, `NotebookSet`, channel set) and MCP share tools return the refusal; OpenAPI documents the 403 and typegen is current; feature tests per app (Calendar, Tasks, Notes, Contacts, chat channel) plus DAV.
- **Verify with:** `composer done-gate` (or `php scripts/done-gate.php`), OpenAPI diff check
- **Parallel with:** `ui-hide-section` is not parallel (waits on this); `api-move`, `migration` after this

### Chunk B: Moving a personal collection into a Team drops its grants

- **id:** `api-move`
- **Skill:** api
- **Inputs:** four `transferOwner` implementations that today leave grants alone — `path: packages/api/app/Services/Calendars/CalendarRepository.php:450`; `path: packages/api/app/Services/Tasks/TaskListRepository.php:304`; `path: packages/api/app/Services/Notes/NotebookRepository.php:389`; `path: packages/api/app/Services/Chat/ChatChannelRepository.php:499`
- **Done when:** when the new owner is a Team, per-person grants are removed in the same transaction as the owner change (revoke through the same helper so the share dismissals and sync tokens stay consistent); Team-to-Team and to-personal moves are unchanged; the move response no longer returns a `shareWith` for those people; feature test per repository.
- **Verify with:** `composer done-gate`
- **Parallel with:** `migration`

### Chunk C: Migration removes existing per-person grants on Team-owned collections

- **id:** `migration`
- **Skill:** api
- **Inputs:** grant storage — `path: packages/api/app/Services/Calendars/CalendarShareInvites.php:50` (instance rows), `path: packages/api/database/migrations/wgw/2026_08_31_000330_wgw_create_addressbook_shares.php:13` (address books); latest migration for naming — `path: packages/api/database/migrations/wgw/2026_11_25_000990_wgw_calendar_subscriptions_key_on_principal.php:1`
- **Done when:** one `WgwMigration` in `database/migrations/wgw/` deletes grantee rows (`calendarinstances` with `access` 2 or 3 and user `principaluri`, including principal-less invalid rows) on every `calendarid` whose owner row is Team-owned, and `addressbook_shares` rows with a user principal on Team-owned books; Team-principal grants are left alone (D1); also clears matching rows in `calendar_share_dismissals`; skips missing tables; has no `down` effect; test seeds personal and Team collections with grants and asserts only the Team ones lose them and the owner and Team access rows stay.
- **Verify with:** `composer done-gate`; the migration test run twice
- **Parallel with:** `api-move`

### Chunk D: UI hides the per-person section on Team and Project collections

- **id:** `ui-hide-section`
- **Skill:** apps-ui
- **Inputs:** shared section — `path: packages/apps/src/share-ui/collection-share-section.tsx:1`; callers — `path: packages/apps/src/calendar-core/src/calendar-share-section.tsx:1`, `path: packages/apps/src/project-dialog/src/project-dialog.tsx:244`, `path: packages/apps/src/meet-core/src/meet-channel-dialog.tsx:305`, `path: packages/apps/src/contacts-core/src/contacts-addressbook-dialog.tsx:173`
- **Done when:** each dialog (Calendar, Tasks, Notes, Meet channel, Project dialog, Contacts address book) renders the section only when the collection is personal (`groupSlug` empty); the Project default collection follows the same rule and `isProjectLocked*` is reconciled with it; the replacement line and the new personal section title follow D5; the section is also hidden while the viewer picks a Team as owner in the same dialog; Storybook story and Vitest per dialog.
- **Verify with:** `pnpm --dir packages/apps exec vitest run` on the touched dialogs; `pnpm run ci:quality:apps`
- **Parallel with:** `api-move`, `migration`

### Chunk E: Owner-move confirm dialog names the loss

- **id:** `ui-move-confirm`
- **Skill:** apps-ui
- **Inputs:** existing confirm in the Calendar dialog — `path: packages/apps/src/calendar-core/src/calendar-calendar-dialog.tsx:373`; owner field — `path: packages/apps/src/ui/owner-scope-field.tsx:1`; Project and Meet dialog owner flows — `path: packages/apps/src/project-dialog/src/project-dialog.tsx:173`, `path: packages/apps/src/meet-core/src/meet-channel-dialog.tsx:194`
- **Done when:** when a personal collection with per-person grants is moved into a Team, the confirm dialog says that the listed people lose access (copy from the shared labels, one string for all apps); no extra text when there are no grants or the move is Team to Team or to personal; Vitest per dialog.
- **Verify with:** `pnpm --dir packages/apps exec vitest run` on the touched dialogs
- **Parallel with:** `ui-hide-section` (different files in the dialogs only if coordinated; otherwise sequential)

### Chunk F: Per-app end-to-end check

- **id:** `per-app-check`
- **Skill:** testing
- **Inputs:** acceptance criteria of Epic #2392 — `cmd: gh issue view 2392`
- **Done when:** for Calendar, Tasks, Notes, Contacts and Meet, a Team-owned collection cannot get a per-person grant through the app UI, REST, JMAP, MCP or DAV, and a personal one still can; a personal collection with grants moved into a Team ends with no grants; live collaboration sessions of a revoked person are checked and the outcome is written on the Epic; per-item move outcome (D4) recorded; the offline effects in the spec are reproduced on a local stack (a device synced before the removal: collection gone after sync, queued offline edit shown as refused, sidebar selection falls back cleanly).
- **Verify with:** the per-app feature tests above plus a browser run on a fresh stack; read-only verifier from `developer/multitask-verifier.md`
- **Parallel with:** none

## Test plan

- [ ] API: OpenAPI → failing feature test → implement → `composer done-gate`
- [ ] UI: mock-tier Storybook → Vitest for logic → optional `play` for the move confirm
- [ ] Migration test on seeded Team and personal collections, run twice

## Doc updates (only if user wants)

- Sharing wording in user docs, with the new section title (D5).
