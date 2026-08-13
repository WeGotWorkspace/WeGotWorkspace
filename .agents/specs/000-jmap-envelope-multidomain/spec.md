Source: #435 (body-hash: 7773425c) — the multi-domain envelope Epic; chore P filed as #436 ([issue-drafts.md](./issue-drafts.md) records the filed set). Each domain has its own spec folder, linked below. External spec status verified against jmap.io and the IETF datatracker 2026-08-13. Tasks (VTODO) removed from the roadmap on maintainer review the same day (see Non-goals). Split into per-domain folders 2026-08-13; issues filed the same day.

# JMAP envelope: multi-domain umbrella (contacts, blobs, files, mail)

Umbrella roadmap for extending the calendars JMAP transport envelope (`.agents/specs/000-jmap-envelope-calendars/`, PR #430) to the other JMAP-shaped domains in `packages/api`. **Status: draft, planning-only.** This folder owns what is shared — sequencing, the decoupling prep chunk, cross-domain constraints, the Epic — and delegates everything domain-specific:

| Domain | Spec folder | External spec | Issue |
|--------|-------------|---------------|-------|
| Contacts | [../437-jmap-envelope-contacts/](../437-jmap-envelope-contacts/spec.md) | RFC 9610 (final) | #437 |
| Blobs (shared infra) | [../438-jmap-blobs/](../438-jmap-blobs/spec.md) | RFC 8620 §6 (final) | #438 |
| Files | [../450-jmap-envelope-filenode/](../450-jmap-envelope-filenode/spec.md) | draft-ietf-jmap-filenode-14 (active, pinned) | #439 (design); build filed after |
| Mail | [../452-jmap-envelope-mail/](../452-jmap-envelope-mail/spec.md) | RFC 8621 (final; phased behind a design gate) | #440 (design gate); M1/M2 only if "build" |

## Goal

One `/api/v1/jmap` front for every JMAP-backed domain. The envelope machinery from #430 (dispatcher, ResultReferences, argument traits, `JmapAccountStateCodec`, error vocabulary, session skeleton, limits) is already domain-agnostic; the domain folders add method handlers and real blob support, and this umbrella's chunk P removes the known calendar couplings first. Ordering by substrate readiness and external-spec maturity: decoupling first, contacts next (same Sabre substrate, repositories exist, final RFC), blobs as the shared unlock, files after a node-identity design decision, mail phased behind a design gate.

## External spec status (verified 2026-08-13)

| Domain | Spec | Status | Capability URN |
|--------|------|--------|----------------|
| Core | RFC 8620 | Final | `urn:ietf:params:jmap:core` |
| Calendars | draft-ietf-jmap-calendars-27 | In progress (shipped in #430) | `urn:ietf:params:jmap:calendars` |
| Contacts | **RFC 9610** (JSContact: RFC 9553) | **Final** | `urn:ietf:params:jmap:contacts` |
| Mail | **RFC 8621** | **Final** | `urn:ietf:params:jmap:mail` (+ `:submission`) |
| Tasks | draft-ietf-jmap-tasks-06 | **Expired draft** (last revision 2023-03-10; IESG-submission milestone since slipped to Mar 2027) — **out of scope**, see Non-goals | `urn:ietf:params:jmap:tasks` |
| Files | draft-ietf-jmap-filenode-14 | **Active draft** (2026-05-15, expires 2026-11-16) | `urn:ietf:params:jmap:filenode` |
| Sharing | RFC 9670 | Final (referenced by filenode; not built here) | — |

## Non-goals (apply to every domain folder)

- **Tasks envelope** — removed from this roadmap (maintainer decision, 2026-08-13): `draft-ietf-jmap-tasks-06` is an expired draft, too immature to justify an envelope next to the shipped REST implementation. The REST-level task item `/changes` + `/set` gap remains tracked independently in `docs/jmap-rest-parity-gaps.md` (#158) and is not part of this plan. Revisit when the WG produces a stable revision.
- JMAP Push (RFC 8620 §7) — clients poll; `eventSourceUrl` stays a 501 stub in every chunk.
- JMAP Sharing writes (RFC 9670 `shareWith`) — stays a read-only mapping (`myRights`) where applicable; consistent with the REST sharing stub.
- Changing REST endpoints or their legacy response shapes (shipped consumers; normalization happens in envelope adapters, mirroring `CalendarEventSetMethod`).
- `createdIds` maps, PatchObject update payloads — same documented deviations as calendars.
- WebSocket transport (RFC 8887), Quotas (RFC 9425), Blob Management extension (RFC 9404 — the core §6 upload/download is in scope via the blobs folder; the extension methods are not).
- Frontend/client work — this roadmap is backend-only; apps adoption is planned separately once each domain's envelope exists.

## Shared technical constraints (chunk P resolves 1–4)

1. **Route placement** — `/jmap*` routes currently live inside the calendars middleware group (`wgw.calendars`, `routes/api.php`), which is a real feature toggle (`EnsureCalendarsEnabled`): disabling calendars today would take the whole envelope down. Must move to a domain-neutral group (`wgw.auth` + `wgw.role:user`); domain availability is then expressed through advertised capabilities + the `using` guard, not feature-gate middleware. Per-domain behavior when a feature toggle (e.g. `wgw.contacts` off) is disabled: capability absent from the session and `using` rejected with `unknownCapability`.
2. **Hardcoded capability lists** — `JmapApiController::handle()` (`$supported`), `JmapSessionController` (capabilities / `accountCapabilities` / `primaryAccounts`), `JmapCapabilities`. Derive the supported set from registered methods' `capability()`; give the session a per-domain capability-provider list.
3. **Dispatcher registration** — constructor-injected method list is fine at 9 methods; switch to a tagged/config array when contacts pushes it past ~15.
4. **Session state constant** — `JmapCapabilities::SESSION_STATE` is spec-legal only while the session document is identical for every account. Once capabilities can differ per account (feature gates), derive it from the enabled capability set.

Domain-specific constraints live in the domain folders (contacts: state primitive + legacy shapes; blobs: reference-protected GC; files: node identity over path-addressed storage; mail: IMAP substrate + state model).

## Shared edge cases (every domain chunk pins these)

- `using` with a capability whose domain feature-gate is disabled → `unknownCapability` (request-level), and the session omits it.
- Mixed-domain batches (e.g. `Calendar/get` + `ContactCard/get` in one request) share one dispatcher pass and per-domain states never bleed into each other's `state` strings.
- Post-write sync takes the incremental `/changes` path (the calendars mismatch-13 regression, replayed per domain).

## Sequencing

```
P (decouple) ─┬─► C  (contacts envelope)
              └─► B  (real blobs) ─┬─► F  (files envelope; F0 design gates F)
                                   └─► M1 (mail read-only) ─► M2 (mail writes + submission)

Independent starts: F0 (filenode design), M0 (mail design; gates M1)
```

Chunk P definition: [plan.md](./plan.md). Epic + chore P issue bodies: [issue-drafts.md](./issue-drafts.md). Domain chunks: their folders (table above).
