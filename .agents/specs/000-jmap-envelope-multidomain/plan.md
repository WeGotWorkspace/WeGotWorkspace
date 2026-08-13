# JMAP envelope: multi-domain umbrella — plan (draft)

Derived from [spec.md](./spec.md). **Status: draft, planning-only.** This umbrella plan owns cross-domain sequencing and the decoupling prep chunk; domain chunks live in their own folders. Tasks chunks (T-rest / T-envelope) were removed 2026-08-13 — spec too immature, see [spec.md Non-goals](./spec.md#non-goals-apply-to-every-domain-folder).

## Cross-domain dependencies

1. Chunk P (below) before any new domain — it removes the calendar couplings the domains would otherwise re-hardcode.
2. Contacts ([../000-jmap-envelope-contacts/](../000-jmap-envelope-contacts/plan.md)) after P; may run parallel with blobs.
3. Blobs ([../000-jmap-blobs/](../000-jmap-blobs/plan.md)) after P; prerequisite for files and mail M1, and for the final form of contacts photo blobIds.
4. Files ([../000-jmap-envelope-filenode/](../000-jmap-envelope-filenode/plan.md)): design doc F0 gates build F; F also needs blobs.
5. Mail ([../000-jmap-envelope-mail/](../000-jmap-envelope-mail/plan.md)): design doc M0 gates M1 (also needs blobs); M2 after M1. M1/M2 exist only if M0 recommends "build".
6. Design docs F0 and M0 have no dependencies — they can start parallel with P.

## Chunks

### Chunk P: envelope decoupling (prep refactor)

- **Branch:** `refactor/jmap-envelope-decouple` (chore — no spec folder required; this plan is the reference)
- **Skill:** api
- Move `/jmap*` routes out of the `wgw.calendars` group to `wgw.auth` + `wgw.role:user`.
- Derive `JmapApiController`'s supported-capability set from registered methods; make session capabilities/`accountCapabilities`/`primaryAccounts` pluggable per domain; feature-gated domains drop out of both (session + `using`).
- Derive session `state` from the enabled capability set (spec constraint 4).
- **Done when:** all existing `tests/Feature/Jmap/*` green unchanged; new test pins `unknownCapability` for a gated-off domain; `composer done-gate`.
- **Parallel with:** F0 and M0 design docs.

## Test plan

Transport tests stay in `JmapDispatcherTest` (chunk P adds the gated-capability case). Each domain folder defines its own method suites and lifecycle contract tests (modeled on `JmapClientContractTest`) plus the shared edge cases from [spec.md](./spec.md#shared-edge-cases-every-domain-chunk-pins-these). Full `composer done-gate` per chunk; live-client e2e per `docs/calendars/jmap-client-e2e.md` where a real client exists.

## Doc updates

Per domain chunk (tracked in the domain folders): `packages/api/docs/calendars/jmap-envelope.md` grows into (or is joined by) per-domain envelope docs; `packages/api/docs/jmap-rest-parity-gaps.md` envelope section updated as domains land; OpenAPI `openapi/schemas/jmap/*` extended per domain.
