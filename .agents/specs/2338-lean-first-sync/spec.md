Source: #2338 (body-hash: 471ef748)
Goal: WeGotWorkspace/Product#153

# Lean-first sync: one shared helper, details fetched later

Technical translation of #2338, a child of Epic #2284 (traffic budget). Spec only: no product code ships with this folder.

## Open product questions (for the product lead — not decided here)

Each has a **default this spec builds in**, so nothing blocks; the answer only changes one constant in the device policy (chunk D).

1. **Which documents and files are kept offline by default?** All / recent only (for example the newest 100, or the last 90 days) / only the ones a person opened. Today every eligible document is downloaded, newest first, up to 8 MB each.
2. **Which contacts details are kept offline by default?** Photos for everyone, or only for people shown on screen.
3. **Public or shared devices.** Should the first sign-in on a device ask "keep my data on this device?" (a lean list only if no), or is that a later setting only?
4. **Storage limit per device.** Is there a hard cap (for example 500 MB) after which the detail pass stops, and what do we tell the person?
5. **Notes and tasks: all bodies or on open?** They are small, so the default here is "all, calm pace"; say if you would rather have "on open".
6. **`maxObjectsInGet`: raise globally, per type, or keep 500?** Technical, but it decides how many requests a first download costs; options and trade-offs are in [plan.md](./plan.md), chunk S.

## Goal

A new browser (or one with cleared data) must reach "usable" fast and cheaply on a shared host that bans an IP above 60 requests per minute. Every app that downloads a collection follows one pattern:

1. **Lean pass.** Fetch only list data: JMAP `properties` projection (RFC 8620 §5.1, standard) or the app's list endpoint. Big pages, no bodies, no photos.
2. **Detail pass.** Fetch the heavy part (bodies, photos, long text) either **on demand** when an item is opened or shown, or in a **paced background pass**, as the device policy says.
3. The pattern lives once in `packages/apps/src/lib`. An app only **declares**: its lean fields, how to fetch the detail for one item or a batch, and its priority. No app writes its own queue, lock, pacer or resume logic.

## Hard rule: a partial record is never saved or edited from its partial copy

A lean record is a **view**, not a source of truth. Every record the lean pass stores carries a completeness marker (`lean` or `full`). Then:

- Any code path that **writes** (edit form, outbox enqueue, whole-object replace, vCard/JSCalendar rebuild, move/copy that re-serialises) must call one shared guard, `requireFullRecord`, which returns the full record or throws a typed error. It never builds a write from a `lean` record.
- Online, the guard fetches the detail at user priority (the person waits, so it jumps the pacer queue). Offline, it throws `OfflineNotCachedError` (already used for this) and the UI shows "not downloaded yet".
- JMAP `/set` **patches** (`PatchObject`) that touch only the changed field are safe from a lean copy and stay allowed; whole-object writes are not. Each adopting app lists which of its writes are whole-object (chunk-level Done when).
- The detail pass **replaces** a lean record with the full one atomically (one IndexedDB transaction). It never merges a full record into a lean one by field, and never overwrites a record whose local copy is newer (pending outbox row) — the existing conflict path decides.
- Proof lives in a shared contract test every adopting app runs: seed a lean record, try each write path, assert zero requests built from the lean copy.

## Non-goals

- The per-device policy UI (a setting or first-run question). Only the policy **shape** and where it is read.
- Deciding the open product questions above.
- Changing push, the doorbell or backup polls (other chunks of #2284).
- Mail (not an offline collection today).
- Changing storage formats beyond adding the completeness marker.

## Affected packages

- packages/apps — new `src/lib/offline/lean-sync/`, adopters in `contacts-core`, `docs-core`, Drive, `notes-core`, `tasks-core`, `calendar-core`; `src/lib/jmap-client/*`.
- packages/api — `JmapCapabilities.php` (`maxObjectsInGet`), a projection that skips work, not only bytes.
- docs — `docs/realtime-capacity.md` (final numbers, chunk J).

## Technical constraints

- **Projection is standard.** `properties` is part of every JMAP `/get` (RFC 8620 §5.1); the server always adds `id`. A client that omits a property must treat it as **unknown**, never as empty (this is the lean-record rule above).
- **The server projects after it builds.** `projectProperties` filters the already-built record (`packages/api/app/Services/Jmap/Methods/Concerns/HandlesGetArguments.php:56`), so a projection saves bytes, not server CPU. The 0.7 ms per card is conversion cost; skipping it needs a pushdown (plan.md chunk S2).
- **Page size.** `maxObjectsInGet` is one constant for every typed get (`packages/api/app/Services/Jmap/JmapCapabilities.php:79`), enforced in `HandlesGetArguments.php:29` and `:50`. Clients already read it from the session (`maxObjectsInGet(this.client.session)`), so a raise needs no client change.
- **One tab, one schedule.** The detail pass runs under a Web Lock (`withCrossTabLock`, `src/lib/offline/core/cross-tab-lock.ts`) and draws from the browser-wide pace schedule of #2290 (not yet on main when this spec was written; chunk C depends on it). Lean pages are first-download traffic too and take the highest priority class; details sit below them.
- **Resumable.** Progress is a cursor in the account meta store (`src/lib/offline/core/meta-store.ts`, as `progressive-sync-runner.ts` already does): a refresh, a second tab or a crash resumes, never restarts, and never re-fetches a record already `full`.
- **Device policy, not app code.** What the detail pass fetches is read from one per-device policy object (extends `src/lib/offline/core/offline-device-settings.ts`, today `contentSyncEnabled` + `maxFileSizeBytes`). Apps ask the policy `shouldPrefetch(kind, item)`; they never hard-code "all" or "recent".
- **Tasks are REST, not JMAP** (`packages/apps/src/lib/api/wgw/tasks.ts:125`), so there is no `properties` argument; lean for Tasks means the list endpoint plus a detail GET (chunk H checks what the list already returns).
- **Docs and Drive are already list-first.** Their bodies are paced, newest first, behind `contentSyncEnabled` and a size cap (`src/lib/offline/docs/docs-body-sync.ts:89`, `src/lib/offline/drive/drive-content-sync.ts:170`). What is missing is one shared queue: the same files are downloaded once per app (measured below).

## Measured starting point (main f39b75fe8, one run each, 2000 contacts and 40 documents)

| app alone | minute 1 | what dominates |
|---|---|---|
| Contacts | 121 | 77 `ContactCard/get` pages |
| Docs | 92 | 41 document bodies |
| Drive | 102 | about 40 file bodies |
| Calendar | 66 | notifications, tasks overlay, invitees (no bulk data) |
| Tasks | 38 | no bulk data |

Source: cold-start notes of the traffic session (not a repository file). The target per app is in plan.md chunk J.

## Edge cases

- Lean record shown, detail not yet fetched: the UI shows what the lean fields give (initials instead of photo, title instead of text); it never shows "empty".
- Item opened while the background pass is mid-flight: the on-demand fetch wins; the pass skips it when it reaches it (already `full`).
- Item changed on the server between the lean and detail pass: the detail fetch returns the newer full record; the push/changes path already updates the list. The stored state advances once, in the same transaction.
- Two tabs, one device: one tab holds the lock and runs the pass; the other reads the shared IndexedDB and gets cache-changed topics.
- Policy flips from "all" to "opened only": the pass stops; already-`full` records stay; nothing is deleted by this change (eviction is a separate decision, open question 4).
- Device storage full: the pass stops and reports; the lean list keeps working.
- Server returns 429 or 503: the shared pacer backs off for the whole browser (existing behaviour); a lean page that fails is retried before any detail work.
- Old client data without a marker: treated as `full` (it was downloaded in full), so upgrade never makes records unwritable.
