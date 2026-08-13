Source: ad-hoc (draft — file Tasks per chunk before starting `feat/` branches; parent under epic #137 or a new envelope epic)

# JMAP envelope: multi-domain expansion (contacts, tasks, mail assessment)

Technical translation for extending the calendars JMAP transport envelope (`.agents/specs/000-jmap-envelope-calendars/`, PR #430) to the other JMAP-shaped domains. **Status: draft** — written ahead of delivery so the follow-up branches can start from a reviewed direction; re-derive from the filed Task issues before building.

## Goal

One `/api/v1/jmap` front for every JMAP-backed domain. The envelope machinery from #430 (dispatcher, ResultReferences, argument traits, account-state codec, error vocabulary, session skeleton, limits) is already domain-agnostic; this work adds domain method handlers and removes the three known calendar couplings. Contacts first (same Sabre substrate, repositories exist), tasks after its REST sync primitives land, mail only after an explicit scoping decision.

## Non-goals

- JMAP Push (RFC 8620 §7) — clients poll; `eventSourceUrl` stays a 501 stub.
- Full RFC 8621 (JMAP Mail) implementation — chunk M below is an assessment, not a build.
- Changing REST endpoints or their legacy response shapes (contacts/tasks keep shipped consumers; normalization happens in envelope adapters, mirroring `CalendarEventSetMethod`).
- `createdIds` maps, PatchObject update payloads — same documented deviations as calendars.

## Affected packages

- packages/api (routes, `app/Services/Jmap/`, `app/Services/Contacts|Tasks/`, OpenAPI, docs)

## Technical constraints and known coupling points

1. **Route placement** — `/jmap*` routes currently live inside the calendars middleware group (`wgw.calendars`, `routes/api.php`). Must move to a domain-neutral group (`wgw.auth` + `wgw.role:user`); domain availability is then expressed through advertised capabilities + the `using` guard, not feature-gate middleware. Decide per-domain behavior when a feature toggle (e.g. contacts disabled) is off: capability absent from the session and `using` rejected with `unknownCapability`.
2. **Hardcoded capability lists** — `JmapApiController::handle()` (`$supported`), `JmapSessionController` (capabilities / `accountCapabilities` / `primaryAccounts`), `JmapCapabilities`. Derive the supported set from registered methods' `capability()`; give the session a per-domain capability-provider list.
3. **Dispatcher registration** — constructor-injected method list is fine at 9 methods; switch to a tagged/config array when contacts pushes it past ~15.
4. **Session state constant** — `JmapCapabilities::SESSION_STATE` is spec-legal only while the session document is identical for every account. Once capabilities can differ per account (feature gates), derive it from the enabled capability set.
5. **Contacts state primitive** — no `addressbookSyncTokens()` analog of `CalendarEventRepository::calendarSyncTokens()` exists yet; the codec itself (`JmapAccountStateCodec`) is already generic over `{uri → token}` maps.
6. **Contacts legacy REST shapes** — string-valued `created`/`updated`, snake_case SetError types (see `docs/jmap-rest-parity-gaps.md`). Envelope methods normalize to RFC 8620 shapes at the adapter layer; REST stays untouched.
7. **Tasks prerequisites** — task item `/changes` + `/set` are still deferred (parity-gaps platform row). REST sync primitives land first (sequenced like #429 → #430), then envelope methods.
8. **Mail is a different substrate** — IMAP-backed, not Sabre. RFC 8621 needs `Mailbox/*`, `Email/query` with threads, and real blob upload/download (the 501 stubs and `maxSizeUpload: 0` are honest today). The account-state codec does not map onto IMAP the way it maps onto synctokens. Chunk M produces a scoping decision (build / defer / reject), not code.

## Edge cases to pin in tests

- `using` with a capability whose domain feature-gate is disabled → `unknownCapability` (request-level), and the session omits it.
- Mixed-domain batches (e.g. `Calendar/get` + `ContactCard/get` in one request) share one dispatcher pass and per-domain states never bleed into each other's `state` strings.
- Contact photo blobs: decide `Blob/upload` scope for contacts (or document the deviation) before advertising `urn:ietf:params:jmap:contacts`.
