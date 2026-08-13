# JMAP envelope: multi-domain expansion — plan (draft)

Derived from [spec.md](./spec.md). **Status: draft** — chunks P and C are ready to become Task issues once PR #430 merges; T and M are sequenced behind their prerequisites.

## Dependencies

1. PR #430 (`feat/jmap-envelope-calendars`) merged.
2. Chunk P before any new domain (it removes the calendar couplings the domains would otherwise re-hardcode).
3. Chunk T-rest before chunk T-envelope.
4. Chunk M is independent (assessment only).

## Chunks

### Chunk P: envelope decoupling (prep refactor)

- **Branch:** `refactor/jmap-envelope-decouple` (no spec required; this plan is the reference)
- Move `/jmap*` routes out of the `wgw.calendars` group to `wgw.auth` + `wgw.role:user`.
- Derive `JmapApiController`'s supported-capability set from registered methods; make session capabilities/`accountCapabilities`/`primaryAccounts` pluggable per domain; feature-gated domains drop out of both (session + `using`).
- Derive session `state` from the enabled capability set (spec constraint 4).
- **Done when:** all existing `tests/Feature/Jmap/*` green unchanged; new test pins `unknownCapability` for a gated-off domain; `composer done-gate`.

### Chunk C: contacts envelope

- **Branch:** `feat/jmap-envelope-contacts` — file Task, spec folder `<N>-jmap-envelope-contacts`
- `addressbookSyncTokens()` primitive; `ContactCard/get|changes|set|query`, `AddressBook/get|changes|set` behind `urn:ietf:params:jmap:contacts`, wrapping existing repositories; legacy REST shapes normalized in the adapters (mirroring `CalendarEventSetMethod`).
- Decide + document blob scope for contact photos (`Blob/upload` or documented deviation).
- **Done when:** contract test mirrors the calendars lifecycle incl. incremental post-write sync; done gate; docs (`jmap-envelope.md` gains the contacts dispatch rows).

### Chunk T-rest: tasks REST sync primitives

- **Branch:** `feat/tasks-item-sync` — file Task under #158/#137 lineage
- Task item `/changes` + `/set` on the existing pattern (`jmap_calendar_event_states` analog or shared table), exactly like #429 did for calendar events.
- **Done when:** parity with calendar event sync tests; parity-gaps doc updated.

### Chunk T-envelope: tasks envelope

- **Branch:** `feat/jmap-envelope-tasks` — file Task, spec folder `<N>-jmap-envelope-tasks`
- `Task/get|changes|set|query` + `TaskList/*` behind the tasks capability URN, wrapping T-rest primitives.
- **Done when:** same lifecycle contract test shape; done gate; docs.

### Chunk M: mail scoping assessment (no code)

- Deliverable: a decision doc (`docs/product/` or epic body) answering: JMAP Mail (RFC 8621) vs existing Mail REST — required surface (Mailbox/Email/threads/blobs/push), IMAP substrate mismatch with the synctoken state codec, shared-hosting constraints (ext-imap optionality, no long-lived connections), and a build/defer/reject recommendation.

## Test plan

Transport tests stay in `JmapDispatcherTest` (chunk P adds the gated-capability case). Each domain chunk ships its own `Jmap<Domain>MethodsTest` + a lifecycle contract test modeled on `JmapClientContractTest`, plus the mixed-domain batch case from spec §Edge cases. Full `composer done-gate` per chunk; live-client e2e per `docs/calendars/jmap-client-e2e.md` where a real client exists.
