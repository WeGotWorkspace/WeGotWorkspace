Source: #545 (body-hash: 9fbe8bf7)
Goal: #385

# Calendar Dexie-first store

Technical translation of Task #545 — not a copy of the issue AC checklist.

## Goal

The week/month grid has one event store online and offline: Lit reads/writes one engine-map (working set); every mutate persists to Dexie + outbox (hybrid ops); the outbox flushes when online; live JMAP `/changes` merges into Dexie and never overwrites pending outbox rows. Online vs offline is only “can the projector push?”, not a second `EventsAPI` or adapter mount/teardown.

## Non-goals

- Yjs / CRDT for events (Contacts/Tasks pattern)
- Rewriting JMAP, the recurrence engine, or the Dexie schema
- Rebuilding collections, invitations, colors, or conflict-dialog UI — keep them; rewire the `reportCalendarsSyncConflicts` channel onto inbound/flush
- Throwing away adapter unit tests for JMAP mapping before inbound sync has its own module
- #540 (create-preview appear/disappear) as a product ticket, except where preview would paint a second card after persist
- Merging or stacking on PR #543 — quarry only

## Affected packages

- packages/apps (`calendar-core`, `lib/offline` calendars domain, `lib/jmap-client/adapter`)
- packages/apps/docs (`offline-platform.md` Calendar row)

## Technical constraints

- One write-path: Lit `apply()` → engine reducer → working set → hybrid `createEvent` / `patchEvent` / `deleteEvent`. No surface-driven `adapter.#queuePush`.
- One paint-path: `events` is always `alignOfflineEventIds(merge(workingSet, data.events))`. Never `phase === "ready" ? adapter.getEvents()`.
- Adapter (or extracted inbound module) is inbound-only: `sync` / poll / `initialize` write Dexie via `upsertCalendarEventInCache` + `patchBootstrap` / `refreshBootstrap`. Skip masters with pending outbox.
- `resolveJmapId` waits on persist-remap / outbox `tempToServerId`, not `adapter.flush()` + `jmapIdForKey`.
- Storybook / mock uses the same EventsAPI + mock/hybrid `operations`. No adapter-as-store in stories.
- Two JMAP clients, one timer: inbound-client owns the only `CALENDAR_BACKGROUND_POLL_MS` loop (`/changes` → Dexie). Hybrid/bootstrap-client is on-demand only (loadBootstrap, outbox flush, explicit refresh) — no `setInterval`.
- Conflict UI stays on `reportCalendarsSyncConflicts` → `useOfflineConflictQueue`. Inbound ingest that clashes with a pending local row uses that same channel. No third listener on Lit/adapter events.
- Port keepers from the #543 quarry (`sabre-installer-calendar-offline`) per the Meenemen table; leave `holdEvents`, overlay/adapter merge, reconnect mount-gate, and dual-path surface tests behind.

## Edge cases

- Reconnect must not wipe event cards (working set stays mounted; no adapter-`{}` paint)
- Offline delete stays gone after reconnect; pending local move is not reverted by inbound ingest
- Temp `local-` ids remap without losing card identity (`eventId` === map key)
- Offline drag-end must not flash back to the old slot; online drag unchanged
- After two poll intervals, exactly one inbound `/changes` series — no second bootstrap-poll beside it
- Remote change that clashes with a pending outbox row still enqueues `reportCalendarsSyncConflicts`
