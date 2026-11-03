# Ownership access matrix (REST + JMAP)

Derived from [spec.md](./spec.md). Chunk layout for parallel or sequential implementation.

## Goal

Prove horizontal authorization for every REST operation and JMAP method across the actors and scopes in [spec.md](./spec.md). A coverage guard makes every new operation declare its rows.

Rows that do not hold are fixed in their own PRs before the suite merges (see Delivery order).

## Budget

Draws from hardening. Displaces no planned work: it goes first. Decided by the product lead on 2026-10-27.

## Non-goals

- See [spec.md](./spec.md) Non-goals.
- No code changes under `packages/api/app`, `packages/api/routes`, or `packages/api/openapi` on this branch.

## What exists

**Role layer**

- `RoleAccessMatrixTest` covers the role layer only.
  - It asserts 401 without a token, 403 for a user token on admin routes, and "not 401/403" otherwise. `path: packages/api/tests/Architecture/RoleAccessMatrixTest.php:61`
  - It never sends a guest-role JWT. `path: packages/api/tests/Architecture/RoleAccessMatrixTest.php:63`

**Coverage sources**

- The REST source of truth is the operation list. `path: packages/api/tests/Support/OpenApiContract.php:70` (`documentedApiOperations`)
- `x-wgw-access` per operation. `path: packages/api/tests/Support/OpenApiContract.php:96` (`operationsWithAccess`)
- The JMAP method registry is a public class list. `path: packages/api/app/Services/Jmap/JmapMethodDispatcher.php:59` (`METHODS`)

**How JMAP denies**

- A foreign `accountId` returns `accountNotFound`, because accountId must equal the caller's username. `path: packages/api/app/Services/Jmap/JmapMethodDispatcher.php:172`
- Blob upload and download for another account return 404. `path: packages/api/app/Http/Controllers/Api/V1/Jmap/JmapBlobController.php:36`

**Route gates**

- User routes sit behind `wgw.auth` + `wgw.role:user`. `path: packages/api/routes/api.php:145`
- Files children, content, and collaboration sit behind `wgw.auth` without a role, so guest JWTs reach them. `path: packages/api/routes/api.php:329`
- Admin routes. `path: packages/api/routes/api.php:340`

**Admin and groups**

- Admin is membership of `principals/groups/administrators`. `path: packages/api/app/Services/Auth/AdminRoleResolver.php:11`
- Group-owned collection delete is admin-only. `path: packages/api/app/Services/Calendars/CalendarCollectionAccess.php:122` (`mayDeleteGroupOwned`)
- Drive resolves rights per path, with no admin case. `path: packages/api/app/Services/Drive/DriveShareAuthorizer.php:195` (`resolvePathContext`)

**Drive public links**

- A drive path denial is caught as `InvalidArgumentException`. The spec's default is 404. `path: packages/api/app/Http/Controllers/Api/V1/Files/FilesController.php:135`
- Session exchange outcomes:
  - Unknown or revoked link: 404 `share_unavailable`.
  - Expired link: 410.
  - Missing or wrong password: 401. `path: packages/api/app/Services/Drive/DriveShareService.php:500`, `:508`, `:514`, `:517`
- A password change revokes open sessions. `path: packages/api/app/Services/Drive/DriveShareService.php:200`
- An expired invite returns 410 `invite_expired`. `path: packages/api/app/Services/Drive/DriveShareService.php:592`
- An unknown or revoked calendar feed token returns 404. `path: packages/api/app/Services/Calendars/CalendarFeedService.php:98`

**Test support**

- The test DB is `RefreshDatabase`, rolled back per test. `path: packages/api/tests/Support/WgwDatabaseTestCase.php:17`
- Seed helpers: `seedWgwUser`, `seedWgwGroup`, and `addPrincipalToGroup`. `path: packages/api/tests/Support/SeedsWgwIdentity.php:13`, `:25`, `:34`
- Tokens can be minted without HTTP. `path: packages/api/tests/Feature/Notes/NotesYjsStateTest.php:359` (`JwtTokenService::issue`)
- Pattern to reuse: role → token and role → accountId maps, plus small static data providers. `path: packages/api/tests/Feature/Drive/Concerns/SharedWorkspaceFixture.php:37`, `packages/api/tests/Feature/Drive/DriveAclMatrixTest.php:30`

**Suites and size**

- Architecture is its own suite and runs before the full run in the done gate. `path: packages/api/phpunit.xml:18`
- Test files are not counted by the file-size ratchet. `path: tools/file-size-ratchet.mjs:24`, with included roots at `:38`

## Considered

- **Extend `RoleAccessMatrixTest`:** rejected. It is a fast contract test with sample paths and empty bodies. This matrix needs real objects in seven scope families, real bodies, and side-effect checks.
- **Annotate OpenAPI with an ownership extension:** rejected. JMAP methods are not OpenAPI operations, and per-scope outcomes are too detailed for the contract.
- **Generate requests from OpenAPI schemas:** rejected. Bodies must reference seeded objects. Each operation instead gets a small hand-written request builder.
- **Extend the per-domain ACL tests:** rejected as the main vehicle, because they have no coverage guard. Their fixtures and helpers are reused.
- **Chosen:** reuse the `DriveAclMatrixTest` pattern, plus the `x-wgw-access` guard pattern from `RoleAccessMatrixTest`.

## Affected packages

- `packages/api` (tests only)

## Dependencies

1. Chunk A lands first. Every other chunk declares rows into its registry and uses its fixtures.
2. Chunks B, C, D, E, F, G, H, and P can then run in parallel.
3. Chunk S runs after chunks B to G, because it adds rows next to theirs.
4. Chunk V runs last.

## Delivery order

This is a process, not a chunk.

1. **Build the chunks** on `test/ownership-matrix-suite`.
2. **Mark a row that does not hold.** The row is marked `pending('P-nnn')`, which reports it as incomplete. The id is an opaque label for the fix.
   - When only the response differs (status, code, or JMAP error type), the marker also names the response the row gives today: `pending('P-nnn', Outcome::Rejected, 'bad_request')`. Only the response may deviate, and only to that outcome. Every other assertion of the row (target unchanged, ids absent, no target content in the body) still fails for real, so a regression behind the marker stays visible.
   - Without an observed outcome every failure of the row is reported as incomplete. That form is only for rows where the access itself is being fixed.
3. **Fix each pending row** in its own PR. A pending row whose declared outcome holds fails, so its marker goes as soon as the fix lands.
4. **Merge the suite** when no row calls `pending`, after chunk V.

## Open decisions

None for the matrix itself. A product decision that a pending row raises ends as a fix or a spec change before the suite merges.

Decided:

- **Default denial for an invisible target** is 404 `not_found`, or JMAP `notFound`.
- **403 `forbidden`** is allowed only when the actor can already see that the target exists: a read-only grant, a non-author in a visible channel, or a member deleting a group collection.
- **Deviations from these defaults are fixed, not encoded.** The matrix does not encode them as expected.
- **A membership check may answer 403** when it gives the same status and body for an existing and a nonexistent target. It then reveals nothing about the target. A matrix row that accepts this also proves the identical answer (for example, the tasks `unknown-group` case).
- **Every member of the owning group may share a group-owned collection** with any internal user or group, and may publish a group calendar as a feed. This is the current behavior (`canShare` is true for every SHAREDOWNER, `path: packages/api/app/Services/Calendars/CalendarShareInvites.php:24`). `admin` has no extra sharing right. Decided by the product lead on 2026-10-27. Admin-only sharing was rejected.

## Invariants

- **The role matrix keeps passing unchanged.** A wrong change would loosen the role layer while the new suite stays green.
  Proof: `cmd: cd packages/api && vendor/bin/phpunit tests/Architecture/RoleAccessMatrixTest.php`, and `cmd: git diff --stat origin/main -- packages/api/tests/Architecture/RoleAccessMatrixTest.php` prints nothing.
- **This branch changes no production code.** Fixes land in their own PRs, so each one is reviewed on its own.
  Proof: `cmd: git diff --stat origin/main -- packages/api/app packages/api/routes packages/api/openapi` prints nothing.
- **After chunk A, the done gate is green** with every undeclared operation on the guard's `pending` list.
  Proof: `cmd: cd packages/api && composer done-gate`.
- **After each domain chunk, the guard is green and the `pending` list has only shrunk.** A wrong change would drop an operation from coverage.
  Proof: `path: packages/api/tests/Architecture/OwnershipMatrixCoverageTest.php`, assertion `test_pending_list_only_names_undeclared_operations`.
- **The existing per-domain ACL tests keep passing.**
  Proof: `cmd: cd packages/api && vendor/bin/phpunit tests/Feature/Jmap tests/Feature/Drive tests/Feature/Tasks tests/Feature/Security`.

## Chunks

### Chunk A: Harness and coverage guard

- **id:** `chunk-a-harness`
- **Skill:** testing
- **Inputs:**
  - Operation lists. `path: packages/api/tests/Support/OpenApiContract.php:70`
  - JMAP registry. `path: packages/api/app/Services/Jmap/JmapMethodDispatcher.php:59`
  - Seed helpers. `path: packages/api/tests/Support/SeedsWgwIdentity.php:13`
  - Token minting. `path: packages/api/tests/Feature/Notes/NotesYjsStateTest.php:359`
- **Done when:**
  - **Registry:** `tests/Support/Ownership/OwnershipRegistry.php` holds one declaration per REST operation and JMAP method. A declaration is either a row set or an exemption with a reason class, and anything else sits on a `pending` list.
  - **World and actors:**
    - `OwnershipWorld` seeds the fixture principals and groups from the spec.
    - It mints tokens for `member` and `admin` with `JwtTokenService`.
    - It provides the `former-group` removal step.
  - **Assertions:** `OwnershipAssertions` holds the shared checks:
    - denied as not found, on REST and on JMAP
    - forbidden
    - unchanged after a denied write, through a snapshot callback
    - absent from a list
    - `pending`
  - **Guard:** `tests/Architecture/OwnershipMatrixCoverageTest.php` fails in these cases:
    - an operation or method has no declaration and is not pending
    - an operation or method has signed-in rows and is also exempt
    - two suites declare the same case key
    - a declaration names something that no longer exists
    - a pending entry is already declared
  - **Exemptions declared:** the 23 admin routes (`admin-target`), the public-token routes, `self` routes, and `no-object` routes.
- **Verify with:** `cmd: cd packages/api && vendor/bin/phpunit tests/Architecture/OwnershipMatrixCoverageTest.php`, then `composer done-gate`.
- **Parallel with:** none.

### Chunk B: Calendars

- **id:** `chunk-b-calendars`
- **Skill:** testing
- **Inputs:**
  - Lookup is limited to own and member-group principals. `path: packages/api/app/Services/Calendars/CalendarRepository.php:363`
  - The event lookup. `path: packages/api/app/Services/Calendars/CalendarEventMutationSupport.php:603`
- **Done when:** these have rows for every applicable ownership and grant scope and every actor, and are off `pending`:
  - JMAP: `Calendar/*` and `CalendarEvent/*`.
  - REST: `calendars/events/import`, `calendars/scheduling/*`, `calendars/subscriptions/*`, and `calendars/{calendarId}/feed`.
  - The publish rows for `own-group` stay in chunk S.
- **Verify with:** `cmd: cd packages/api && vendor/bin/phpunit tests/Feature/Ownership/CalendarsOwnershipTest.php`, and the guard test.
- **Parallel with:** C, D, E, F, G, H, P.

### Chunk C: Tasks

- **id:** `chunk-c-tasks`
- **Skill:** testing
- **Inputs:** task list and task lookup. `path: packages/api/app/Services/Tasks/TaskListRepository.php:278`, `packages/api/app/Services/Tasks/TaskRepository.php:535`
- **Done when:**
  - Every `tasks/*` REST operation has rows and is off `pending`.
  - That includes two-target cases for `taskListIds` and `filter.inTaskList`.
- **Verify with:** `cmd: cd packages/api && vendor/bin/phpunit tests/Feature/Ownership/TasksOwnershipTest.php`.
- **Parallel with:** B, D, E, F, G, H, P.

### Chunk D: Notes

- **id:** `chunk-d-notes`
- **Skill:** testing
- **Inputs:** note lookup. `path: packages/api/app/Services/Notes/NoteRepository.php:482`
- **Done when:**
  - These have rows and are off `pending`:
    - REST: `notes/notebooks/*` and `notes/items/*`.
    - JMAP: `Notebook/*` and `Note/*`.
  - That includes two-target cases for `notebookId` on create and move, and for `PUT /notes/items/{noteId}` collaboration.
- **Verify with:** `cmd: cd packages/api && vendor/bin/phpunit tests/Feature/Ownership/NotesOwnershipTest.php`.
- **Parallel with:** B, C, E, F, G, H, P.

### Chunk E: Chat

- **id:** `chunk-e-chat`
- **Skill:** testing
- **Inputs:**
  - Channel lookup. `path: packages/api/app/Services/Chat/ChatChannelRepository.php:375`
  - Author-only message edit. `path: packages/api/app/Services/Chat/ChatMessageRepository.php:400`
- **Done when:**
  - These have rows and are off `pending`:
    - REST: `chat/*`.
    - JMAP: `ChatChannel/*` and `ChatMessage/*`.
  - That includes:
    - client-chosen channel `id` and `groupSlug` on create
    - `/chat/dms` `principal`
    - read markers and reactions
    - author-only edit
- **Verify with:** `cmd: cd packages/api && vendor/bin/phpunit tests/Feature/Ownership/ChatOwnershipTest.php`.
- **Parallel with:** B, C, D, F, G, H, P.

### Chunk F: Contacts

- **id:** `chunk-f-contacts`
- **Skill:** testing
- **Inputs:** writable check. `path: packages/api/app/Services/Contacts/AddressBookCollectionAccess.php:124`
- **Done when:** these have rows and are off `pending`:
  - JMAP: `AddressBook/*` and `ContactCard/*`.
  - REST: `contacts/cards/import`.
- **Verify with:** `cmd: cd packages/api && vendor/bin/phpunit tests/Feature/Ownership/ContactsOwnershipTest.php`.
- **Parallel with:** B, C, D, E, G, H, P.

### Chunk G: Drive, docs threads, search, and blobs

- **id:** `chunk-g-drive`
- **Skill:** testing
- **Inputs:**
  - Path rights. `path: packages/api/app/Services/Drive/DriveShareAuthorizer.php:195`
  - Blob resolver. `path: packages/api/app/Services/Jmap/FileNodes/FileNodeBlobResolver.php:36`
- **Done when:** these have rows for ownership and grant scopes at every drive level, and are off `pending`:
  - REST:
    - `files/*` member routes and share management
    - `files/threads/*`
    - `search/results` and `search/results/{resultId}/content`
  - JMAP: `FileNode/*`, plus `jmap/upload` and `jmap/download`.
- **Verify with:** `cmd: cd packages/api && vendor/bin/phpunit tests/Feature/Ownership/DriveOwnershipTest.php`.
- **Parallel with:** B, C, D, E, F, H, P.

### Chunk H: Account-scoped records, meetings, and RTC rooms

- **id:** `chunk-h-account`
- **Skill:** testing
- **Inputs:**
  - Notifications are scoped by principal. `path: packages/api/app/Services/Notify/NotificationInboxService.php:20`
  - MCP grants are scoped by user. `path: packages/api/app/Services/Mcp/McpGrantService.php:66`
- **Done when:**
  - These have `own-user` and `other-user` rows and are off `pending`:
    - `notifications/*` and push subscriptions, including another user's endpoint
    - `settings/mcp-grants/*`
    - `meetings/rooms/*`
    - `rooms/{roomId}/*`, with collab and principal rooms for files and groups the actor cannot reach
  - Each `self` exemption is confirmed by one case proving it ignores ids in the request.
- **Verify with:** `cmd: cd packages/api && vendor/bin/phpunit tests/Feature/Ownership/AccountOwnershipTest.php`.
- **Parallel with:** B, C, D, E, F, G, P.

### Chunk P: Public access

- **id:** `chunk-p-public`
- **Skill:** testing, security
- **Inputs:**
  - Session exchange. `path: packages/api/app/Services/Drive/DriveShareService.php:481`
  - Feed token lookup. `path: packages/api/app/Services/Calendars/CalendarFeedService.php:89`
- **Done when:**
  - Every public scope in the spec has its cases: `calendar-feed`, `link-open`, `link-password`, `link-expired`, `link-revoked`, `email-invite`, and `rsvp`.
  - The `guest` actor is run against every `wgw.role:user` operation, expecting 403, and against the `wgw.auth`-only routes, expecting the subtree and level of its link.
  - It includes the traversal and sibling-prefix cases.
- **Verify with:** `cmd: cd packages/api && vendor/bin/phpunit tests/Feature/Ownership/PublicAccessOwnershipTest.php`.
- **Parallel with:** B, C, D, E, F, G, H.

### Chunk S: Sharing and publishing group-owned collections

- **id:** `chunk-s-group-sharing`
- **Skill:** testing
- **Inputs:** `canShare` for SHAREDOWNER. `path: packages/api/app/Services/Calendars/CalendarShareInvites.php:24`
- **Done when:**
  - The `own-group` cells of the Share or publish column have rows for calendars, task lists, notebooks, chat, address books, and drive, with `member` and `admin` both allowed, as decided under Open decisions.
  - The `group-to-nonmember-*` scope proves the grant reaches only that collection.
- **Verify with:** `cmd: cd packages/api && vendor/bin/phpunit tests/Feature/Ownership/GroupSharingOwnershipTest.php`.
- **Parallel with:** none (it runs after B to G, because it touches their row files).

### Chunk V: Cross-chunk verify

- **id:** `chunk-v-verify`
- **Skill:** testing, code-review
- **Inputs:** all chunks merged on the local branch.
- **Done when:**
  - The guard's `pending` list is empty.
  - No row calls `pending`.
  - The matrix adds at most 180 seconds to the local SQLite run.
  - A read-only verifier subagent returns `PASS` or `PASS_WITH_NITS`, using the prompt from [developer/multitask-verifier.md](../../skills/developer/multitask-verifier.md).
  - The parent has run [done-checklist](../../skills/developer/done-checklist.md).
- **Verify with:** `cmd: cd packages/api && composer done-gate`, and `cmd: grep -rln -- '->pending(' packages/api/tests/Feature/Ownership | grep -v OwnershipHarnessTest.php` prints nothing. The harness test calls `pending` to test the marker itself.
- **Parallel with:** none.

## Test plan

- [ ] Chunk A: the guard is red first (one undeclared operation that is not pending), then green.
- [ ] Each domain chunk: write the rows from the spec defaults. Every red row is marked pending before the chunk is done.
- [ ] Mutation spot check per domain: remove one ownership check locally, confirm the matrix goes red, and restore it. The check is not committed.
- [ ] `composer done-gate` before the suite PR.

## Doc updates (only if user wants)

- `packages/api/docs/`: a short note on how to declare rows for a new endpoint.
