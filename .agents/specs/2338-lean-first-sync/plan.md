# Lean-first sync: one shared helper, details fetched later

## Goal

Every offline collection downloads **list data first** (JMAP `properties` projection or the app's list endpoint) in big pages, then fetches the heavy part later: on demand when an item is shown or opened, or in a paced, resumable background pass that the **per-device policy** allows. One helper in `packages/apps/src/lib/offline/lean-sync/` owns the queue, the Web Lock, the resume cursor, the priority and the partial-record guard. Apps only declare. Contacts is the reference case and is being built in its own session; this plan retrofits it onto the shared helper rather than duplicating its code.

## Budget

Draws from the per-IP request allowance (60/min on the named host) and, for the detail pass, from the browser-wide pace schedule of #2290. Displaces: nothing visible; lists and search work from lean data, details arrive a little later or on open. Adds no process, connection or table. Adds one small completeness marker per stored record.

## Non-goals

- The per-device setting UI and the first-run question for shared devices.
- Deciding the open product questions at the top of [spec.md](./spec.md).
- Eviction of already-downloaded data.
- Changes to push, the doorbell or backup polls.

## What exists

- Notes already pass `properties` through `Note/get` and fetch ids in chunks of the session's `maxObjectsInGet`. `path: packages/apps/src/lib/jmap-client/notes/JmapNotesClient.ts:67`
- The server projects after building the record, so `properties` saves bytes, not conversion work. `path: packages/api/app/Services/Jmap/Methods/Concerns/HandlesGetArguments.php:56`
- `maxObjectsInGet` is one constant, used by the capability document and by both bound checks of every typed get. `path: packages/api/app/Services/Jmap/JmapCapabilities.php:79`, `:99`, `path: packages/api/app/Services/Jmap/Methods/Concerns/HandlesGetArguments.php:29`, `:50`
- Typed get methods that use the shared argument handling: Note, Notebook, ContactCard, AddressBook, CalendarEvent, Calendar, FileNode, ChatMessage, ChatChannel, TeamMember, Mailbox, Quota and the Blob gets. `path: packages/api/app/Services/Jmap/Methods/NoteGetMethod.php:1`, `path: packages/api/app/Services/Jmap/Methods/ContactCardGetMethod.php:1`, `path: packages/api/app/Services/Jmap/Methods/FileNodeGetMethod.php:1`
- Docs bodies sync newest first behind `contentSyncEnabled`, a size cap and the shared pacer. `path: packages/apps/src/lib/offline/docs/docs-body-sync.ts:87`, `:94`, `:97`
- Drive content sync does the same for Drive, separately, with its own queue. `path: packages/apps/src/lib/offline/drive/drive-content-sync.ts:170`, `:186`
- The per-device content settings already exist as local storage: `contentSyncEnabled` and `maxFileSizeBytes`. `path: packages/apps/src/lib/offline/core/offline-device-settings.ts:1`, `:7`
- A resumable runner with a stored progress cursor and 429 handling exists. `path: packages/apps/src/lib/offline/core/progressive-sync-runner.ts:69`
- A cross-tab Web Lock helper exists. `path: packages/apps/src/lib/offline/core/cross-tab-lock.ts:15`
- "Not downloaded yet while offline" has a typed error. `path: packages/apps/src/lib/offline/core/offline-not-cached-error.ts:6`
- Tasks are read over REST (`/tasks/items`), not JMAP, so there is no `properties` argument. `path: packages/apps/src/lib/api/wgw/tasks.ts:125`
- Measured cold start per app on main f39b75fe8: Docs 92 requests in minute 1 (41 bodies), Drive 102 (about 40 bodies), Contacts 121 (77 card pages), Calendar 66, Tasks 38. Source: the traffic session's cold-start notes (not a repository file); the target numbers are in chunk J.
  ```text
  Docs 92 (41 bodies), Drive 102 (~40 bodies), Contacts 121 (77 ContactCard/get), Calendar 66, Tasks 38
  ```
- Contacts first download today: 40-card pages; #2297 asks for 200-card pages with a projection that leaves out photos, photos in a second pass. Source: [#2297](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/2297), acceptance criteria.

## Considered

Considered: per-app lean logic (as Contacts #2297 would be on its own), a server-side "lean" flag per type, and one shared helper — chosen: the shared helper, because queue, lock, resume, priority and the partial-record guard are identical for every app and Wouter's rule is shared by default. A server-only fix (bigger pages) — rejected as the whole answer: it cuts request count but not bytes, and a first download would still pull every body. Storing lean and full records in two stores — rejected: a marker on one record keeps list, search and open on one read path. A server-side "lean" mode that returns only list fields for any `/get` without `properties` — rejected: it changes RFC 8620 behaviour (omitted `properties` means all). Fetching details only on open as the only mode — rejected as the only mode: offline use of a document never opened would fail; the device policy chooses per device. Hard-coding "all" or "recent" per app — rejected: public devices and storage limits need a per-device choice. Raising `maxObjectsInGet` globally as the default — kept as an option, not chosen, see chunk S.

## Affected packages

- packages/apps
- packages/api
- docs

## Dependencies

1. Chunk S1 (server constant decision) is independent and gated by an open product-adjacent choice; nothing else waits for it.
2. Chunk A (record marker + guard) first: every adopter needs it.
3. Chunk B (detail runner: lock, cursor, priority) after A, and after #2290's schedule is on main. Lean-pass adopters must not store projected records before chunk A lands, or must write the `lean` marker themselves (the contacts-lean-first work, #2297, is the live case; chunk E re-marks what it already stored).
4. Chunk D (device policy) after A; B reads it through a small interface so B and D can be built in parallel once A has landed.
5. Chunk E (Contacts) after A, B, D, and after the contacts-lean-first PR has landed: E moves its code onto the helper and deletes the duplicate.
6. Chunks F (Docs + Drive), G (Notes), H (Tasks), I (Calendar events) after A, B, D; independent of each other.
7. Chunk S2 (projection pushdown) after E shows the measured cost; it is optional and needs a measurement first.
8. Chunks E and F (measured Done when) and chunk J need the #2292 harness on main (Epic #2284 chunk H; no `playwright.traffic.config.mjs` exists yet). Chunk J is last. Chunk V verifies across chunks.

## Open decisions

- [ ] Chunk S1: `maxObjectsInGet` — global raise, per-type values, or keep 500. Do not start S1 until the product lead answers question 6 in spec.md. The other chunks do not depend on it: they read the value from the session.

## Invariants

- Nothing writes from a lean record. A wrong change lets a whole-object write (for example a contact rebuilt without its photo) overwrite the full record with a partial one. Proof: `path: packages/apps/src/lib/offline/lean-sync/lean-guard.contract.test.ts` assertion `no write path is built from a lean record`.
- A record stored before this change (no marker) stays writable. A wrong change makes every existing record read-only after upgrade. Proof: `path: packages/apps/src/lib/offline/lean-sync/lean-guard.test.ts` assertion `a record without a marker counts as full`.
- A second tab never runs a second detail pass. A wrong change doubles detail requests per browser. Proof: `path: packages/apps/src/lib/offline/lean-sync/detail-runner.test.ts` assertion `only the lock holder fetches`.
- A refresh mid-pass resumes at the cursor and re-fetches no `full` record. A wrong change restarts the whole download after every reload. Proof: `path: packages/apps/src/lib/offline/lean-sync/detail-runner.test.ts` assertion `resume skips full records`.
- The detail pass never runs ahead of lean pages or a user-waited fetch. A wrong change makes a click queue behind 200 background bodies. Proof: `path: packages/apps/src/lib/offline/lean-sync/priority.test.ts` assertion `user fetch jumps the queue`.
- With the policy set to "do not keep everything offline", the pass fetches nothing in the background. A wrong change downloads bodies on a public device. Proof: `path: packages/apps/src/lib/offline/lean-sync/device-policy.test.ts` assertion `policy off fetches no details`.
- After chunk A, main still works without the next chunk (the marker is written only by lean adopters, absent means full). Proof: `cmd: pnpm --dir packages/apps exec vitest run src/lib/offline`.
- After each adopter chunk, its app still passes its own suite and the shared contract test. Proof: `cmd: pnpm --dir packages/apps exec vitest run src/lib/offline/lean-sync`.

## Chunks

### Chunk S1: maxObjectsInGet decision and constant
- **Skill:** api
- **Inputs:** one constant, two bound checks, session capability — `path: packages/api/app/Services/Jmap/JmapCapabilities.php:79`, `path: packages/api/app/Services/Jmap/Methods/Concerns/HandlesGetArguments.php:29`
- **Done when:** the product lead has chosen one of the options below, and the code and `docs/realtime-capacity.md` match it. A feature test asserts the capability value and that `requestTooLarge` fires one past the bound for every typed get.
- **Verify with:** `php scripts/done-gate.php` (from `packages/api`) and `cmd: grep -rn maxObjectsInGet packages/api/app packages/api/openapi/openapi.json`
- **Parallel with:** none (everything else ignores it until it lands)

Options, none chosen here:

| Option | What changes | For | Against |
|---|---|---|---|
| Keep 500 (RFC minimum) | nothing | Matches the RFC floor; clients that read the session stay valid; lean pages of 200 already cut Contacts to 10 requests per 2000 | Notes and Calendar events with tiny lean records still need one request per 500 (Tasks are REST and unaffected) |
| Global raise (for example 1000 or 2000) | the one constant | One-line change; every client benefits; fewer requests | Every typed get can now build 2000 records in one PHP request: a 500-card get is 0.36 s, so 2000 is about 1.4 s plus memory, on 5 FPM children, with no timeout headroom on the slowest hosts; a get of full Contacts with photos could pass the shared host's 30 s limit; `maxObjectsInSet` stays 200, so the two sides become unequal |
| Per-type value | `maxObjectsInGet` becomes a map or a per-type constant; the core capability keeps 500 and each type's own capability advertises its own limit | Cheap types (Note without `body`, CalendarEvent list fields) get big pages; heavy types (ContactCard, FileNode) stay small | RFC 8620 §2 defines one `maxObjectsInGet` in the core capability, so a per-type value is a WGW extension that standard clients ignore (they still stay valid at 500); clients must read the per-type value; more code and tests |
| Raise only when `properties` omits heavy fields | the bound is checked against a cost estimate | Big lean pages, small full pages | Non-standard behaviour (the bound depends on `properties`), harder to reason about and test |

### Chunk S2: projection that skips work (optional)
- **Skill:** api
- **Inputs:** projection happens after the record is built — `path: packages/api/app/Services/Jmap/Methods/Concerns/HandlesGetArguments.php:56`; cost per card measured at about 0.7 ms (Epic #2284, section "Principle: the push doorbell")
- **Done when:** for ContactCard, a `properties` list without photo media does not read or convert photos; a 200-card projected get is at least 2x faster than the unprojected one on the reference stack, measured and quoted in the PR. If the measured gain is under 1.3x, close this chunk with the numbers and change nothing.
- **Verify with:** `php scripts/done-gate.php` (from `packages/api`); feature test asserting that photo columns are not selected (query log); timings are quoted in the PR, not asserted
- **Parallel with:** none

### Chunk A: record marker and write guard
- **Skill:** workspace
- **Inputs:** the typed "not downloaded" error and mirror rows — `path: packages/apps/src/lib/offline/core/offline-not-cached-error.ts:6`, `path: packages/apps/src/lib/offline/core/mirror-cache.ts:45`
- **Done when:** `src/lib/offline/lean-sync/` exports `LeanCompleteness` (`lean` | `full`), `isLean(record)`, `markLean(record, missingProperties)`, and `requireFullRecord(record, fetchDetail)`, which returns a full record, or throws `OfflineNotCachedError` offline. A record without a marker is `full`. A shared contract test factory `describeLeanWriteContract(adapter)` seeds a lean record, runs each declared write path and asserts none builds a write from it.
- **Verify with:** `cmd: pnpm --dir packages/apps exec vitest run src/lib/offline/lean-sync`
- **Parallel with:** S1, S2

### Chunk B: detail runner (lock, cursor, priority)
- **Skill:** workspace
- **Inputs:** resumable runner with a stored cursor and 429 handling — `path: packages/apps/src/lib/offline/core/progressive-sync-runner.ts:69`; Web Lock helper — `path: packages/apps/src/lib/offline/core/cross-tab-lock.ts:15`; the browser-wide schedule of #2290 (must be on main first)
- **Done when:** `runLeanDetailPass(declaration)` runs under one Web Lock per collection, resumes from a stored cursor, skips `full` records, fetches detail in batches the declaration allows, takes its pace and priority from the #2290 schedule (class order: lean pages, then user-waited fetches, then detail pass, then low-priority extras such as photos), and stops on policy off, tab hidden for the schedule's limit, or 429 backoff. `fetchDetailNow(id)` is the on-demand path: user priority, writes the full record atomically, no merge by field.
- **Verify with:** `cmd: pnpm --dir packages/apps exec vitest run src/lib/offline/lean-sync` including the tests named under Invariants
- **Parallel with:** chunk D after A has landed

### Chunk D: per-device detail policy (shape only)
- **Skill:** workspace
- **Inputs:** device content settings in local storage — `path: packages/apps/src/lib/offline/core/offline-device-settings.ts:7`
- **Done when:** `OfflineDeviceContentSettings` gains a `detailPolicy` field: `{ mode: "all" | "recent" | "opened", recentLimit?: number, maxStorageBytes?: number }` with the default `all` (today's behaviour, so nothing changes on upgrade) and a pure `shouldPrefetch(policy, kind, item)`. Existing `contentSyncEnabled` and `maxFileSizeBytes` keep their meaning and are folded in, not duplicated. No UI. The helper reads policy only through this function.
- **Verify with:** `cmd: pnpm --dir packages/apps exec vitest run src/lib/offline/core/offline-device-settings.test.ts src/lib/offline/lean-sync/device-policy.test.ts`
- **Parallel with:** chunk B after A has landed

### Chunk E: Contacts onto the shared helper (reference case)
- **Skill:** workspace
- **Inputs:** Contacts first download — `path: packages/apps/src/lib/jmap-client/contacts/JmapContactsClient.ts:384`; the in-flight contacts-lean-first PR defines the lean fields; do not duplicate its code before it lands
- **Done when:** Contacts declares: lean = a `properties` array with every `ContactCard` property except `media` (photo bytes are inlined there as `data:` URIs by `ContactMediaBlobResolver`); keep `uid`, `name`, `emails`, `phones`, `organizations`, `addressBookIds`, addresses; detail = `media` only (low priority, or on demand when a card is shown); no card is written from a lean copy — contact edit, move between address books and vCard re-serialisation call `requireFullRecord`. The Contacts-specific queue and resume code that the reference PR added is deleted in favour of the helper. Cards stored by the pre-helper lean pass carry no marker: chunk E marks them `lean` (cache-version bump: a row without photo data is `lean`) or re-fetches them, and a test proves a card stored before the upgrade is not written back without its photo (`path: packages/apps/src/contacts-core/lean-contact-migration.test.ts` assertion `pre-helper lean cards are lean`). Measured (needs the #2292 harness) on a cold start with 2000 contacts and 40 documents: contacts ready in under 60 s, fewer than 120 requests in minute 1 (the #2290 and #2297 numbers).
- **Verify with:** `cmd: pnpm --dir packages/apps exec vitest run src/contacts-core src/lib/offline/lean-sync`; the harness numbers in chunk J
- **Parallel with:** F, G, H, I

### Chunk F: Docs and Drive share one body queue
- **Skill:** workspace
- **Inputs:** two separate queues — `path: packages/apps/src/lib/offline/docs/docs-body-sync.ts:97`, `path: packages/apps/src/lib/offline/drive/drive-content-sync.ts:186`
- **Done when:** Docs and Drive each declare the listings that already feed their queues: Docs uses `WgwUnifiedSearchResult` (`sourceKey`, `title`, `size`, `modifiedAt`, `nodeId`; `packages/apps/src/lib/api/wgw/search.ts`), Drive uses its cache entry (`path`, `size`, `time`, `type`; `syncDriveContentFromCache`). On a FileNode object the parent is `parentId`, file versus directory is `nodeType`, and `type` is the MIME type. Both map to **one key** (the FileNode id; chunk F's first task is the mapping from `sourceKey` and from Drive `path`) and write bodies into **one shared store**, so a file both apps want is downloaded once, not twice. Bodies follow the device policy: `all` (default) newest first as today, `recent`, or `opened`; opening a file fetches it at user priority. Writes: opening a file in the editor requires its body (`requireFullRecord`); a file whose body is not downloaded is never created, replaced or re-uploaded from the listing row. Measured (needs the #2292 harness): Docs-only and Drive-only cold start each under 60 requests in minute 1 (from 92 and 102) with 40 documents, and the same 40 files are fetched once when both apps run.
- **Verify with:** `cmd: pnpm --dir packages/apps exec vitest run src/docs-core src/lib/offline/docs src/lib/offline/drive src/lib/offline/lean-sync`
- **Parallel with:** E, G, H, I

### Chunk G: Notes
- **Superseded by** [2284-notes-lean-first](../2284-notes-lean-first/spec.md): Notes bodies can be large, so Notes needs a server `preview`, a partial marker and its own detail pass. The text below is kept for history.
- **Skill:** workspace
- **Inputs:** `properties` already supported — `path: packages/apps/src/lib/jmap-client/notes/JmapNotesClient.ts:67`; ids are fetched with `Note/query` then explicit-id gets — `path: packages/apps/src/lib/jmap-client/notes/JmapNotesClient.ts:88`
- **Done when:** Notes declares lean = every `Note` property except `body` (`packages/apps/src/lib/jmap-client/notes/types.ts:21`), detail = body, policy default `all` at calm pace, opened note fetched at user priority. Notes are small, so the gain is small: the chunk exists mainly so Notes follows the same rule and guard. Editing a note calls `requireFullRecord`; a note whose body is not downloaded is never saved from the list copy. Measured with 500 notes: lean pass is `ceil(500 / page)` requests and no body requests until the detail pass starts.
- **Verify with:** `cmd: pnpm --dir packages/apps exec vitest run src/notes-core src/lib/offline/lean-sync`
- **Parallel with:** E, F, H, I

### Chunk H: Tasks
- **Skill:** workspace
- **Inputs:** Tasks use REST, no projection argument — `path: packages/apps/src/lib/api/wgw/tasks.ts:125`
- **Done when:** `GET /tasks/items` already returns the full OpenAPI `Task` including `description`, so that payload is the lean data and no `fields` query is added. The detail is `GET /tasks/items/{taskId}/text` (live title, description and Yjs state), fetched by the shared detail pass under the device policy (default `all`, calm pace; question 5) and at user priority when a task is opened. `requireFullRecord` guards edits of that text. Measured: Tasks cold start stays at or under 38 requests in minute 1.
- **Verify with:** `cmd: pnpm --dir packages/apps exec vitest run src/tasks-core src/lib/offline/lean-sync`
- **Parallel with:** E, F, G, I

### Chunk I: Calendar events (small win)
- **Skill:** workspace
- **Inputs:** `CalendarEvent/get` — `path: packages/apps/src/lib/jmap-client/calendars/JmapCalendarsClient.ts:98`; query back-referenced into get in one round trip — `:152`
- **Done when:** the visible-range get requests `uid`, `title`, `start`, `duration`, `showWithoutTime`, `timeZone`, `calendarIds`, `recurrenceRules`, `recurrenceOverrides`, `color` and `locations` (what `jmapEventToInternalRows` in `packages/apps/src/lib/jmap-client/mapping/event.ts` needs to place an event) and leaves out `description`, `participants`, `links` and `alerts`; the detail, a full `CalendarEvent/get` of that id, loads on open at user priority and is cached. An event whose detail is not downloaded is never saved, and its invitation is never answered, from the lean copy (`requireFullRecord`; RSVP and edit are the whole-object risks). Calendar already avoids bulk data (no `listCards`), so the measured win is bytes per range request, quoted in the PR; the request count is not expected to fall.
- **Verify with:** `cmd: pnpm --dir packages/apps exec vitest run src/calendar-core src/lib/offline/lean-sync`
- **Parallel with:** E, F, G, H

### Chunk J: harness numbers and docs
- **Skill:** testing
- **Inputs:** the traffic harness from #2292 (not on main yet; it adds `playwright.traffic.config.mjs`) run as `WGW_TRAFFIC_MINUTES=3 pnpm exec playwright test --config playwright.traffic.config.mjs` in `packages/apps`; the cold-start table in spec.md
- **Done when:** one cold-start run per app (2000 contacts, 40 documents, one tab, three minutes), before and after, cross-checked against the PHP request log, written into `docs/realtime-capacity.md` with the policy defaults. Targets: Docs and Drive each under 60 requests in minute 1; Contacts under 120 in minute 1 and ready offline in under 60 s; all five apps together under 200 in minute 1. If a target is missed the doc says so with the number.
- **Verify with:** `cmd: pnpm run check:agent-docs`; the harness output attached to the PR
- **Parallel with:** none (last)

### Chunk V: Cross-chunk verify
- **Skill:** testing
- **Inputs:** [developer/multitask-verifier.md](../../skills/developer/multitask-verifier.md)
- **Done when:** a read-only verifier subagent reports `PASS` or `PASS_WITH_NITS`, and the parent ran [done-checklist](../../skills/developer/done-checklist.md). The verifier also tries each hard-rule scenario by hand in a browser: lean contact edit offline, refresh mid-pass, second tab, policy off.
- **Verify with:** verifier report plus the done checklist
- **Parallel with:** none
