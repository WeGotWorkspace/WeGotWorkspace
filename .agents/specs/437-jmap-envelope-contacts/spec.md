Source: #437 (body-hash: 96c87f25). Parent epic: #435. Umbrella roadmap with sequencing and shared constraints: [../000-jmap-envelope-multidomain/](../000-jmap-envelope-multidomain/spec.md).

# JMAP envelope: contacts (RFC 9610)

Add `AddressBook/*` and `ContactCard/*` to the JMAP transport envelope behind `urn:ietf:params:jmap:contacts`, wrapping the existing contacts services — the same additive-adapter pattern as calendars (PR #430). **Status: draft, planning-only.**

## External spec

**RFC 9610** (final) over JSContact (RFC 9553). The REST layer already implements the matching object model (`AddressBook`, `ContactCard`) and CardDAV conversion matrix (`packages/api/docs/contacts/rfc9610-summary.md`), which makes contacts the most spec-stable and lowest-risk envelope domain.

## Goal

`AddressBook/get|changes|set` and `ContactCard/get|changes|set|query` (+ `queryChanges` → `cannotCalculateChanges`, matching calendars) dispatched over the **existing, unmodified** contacts services: `AddressBookRepository`, `ContactCardRepository`, `ContactCardSetService`, `JmapContactStateService` (table `jmap_contact_states`). No storage rewrite — envelope adapters only.

## Non-goals

- Changing the REST endpoints or their legacy response shapes (shipped consumers).
- JMAP Sharing writes; Push — see umbrella non-goals.
- Real envelope blobs — interim deviation documented below; superseded by the blobs chunk ([../438-jmap-blobs/](../438-jmap-blobs/spec.md)).

## Technical constraints

1. **State primitive missing** — no `addressbookSyncTokens()` analog of `CalendarEventRepository::calendarSyncTokens()` exists yet; the envelope codec (`JmapAccountStateCodec`) is already generic over `{uri → token}` maps, so this is the only new data-access primitive needed.
2. **Legacy REST shapes** — `ContactCardSetService` still returns string-valued `created`/`updated` maps and snake_case SetError types (`docs/jmap-rest-parity-gaps.md`, verified against `main` 2026-08-13). Envelope methods normalize to RFC 8620 shapes at the adapter layer, mirroring `CalendarEventSetMethod`; REST stays untouched.
3. **Photo blobs (interim)** — RFC 9610 `media` properties carry `blobId`s. Until the blobs chunk lands, these resolve against the existing REST blob store (`ContactBlobService`, `ContactMediaBlobResolver`, `POST/GET /contacts/blobs`); document the deviation. After the blobs chunk: envelope-uploaded blobIds must resolve too.
4. **Top-level `ifInState`** — implement genuine RFC 8620 §5.3 top-level `ifInState` on `ContactCard/set` with account-wide codec states, independent of any per-record REST mechanism (same reconciliation decision as calendars).

## Edge cases to pin in tests

- Mixed-domain batch (`Calendar/get` + `ContactCard/get` in one request): one dispatcher pass, per-domain states never bleed into each other's `state` strings.
- Post-write sync takes the incremental `/changes` path (the calendars mismatch-13 regression, replayed for contacts).
- `media` referencing an unknown/foreign blobId → `invalidProperties` SetError, never a 500.
- Address book deleted between `sinceState` and now → previously recorded card ids reported `destroyed` (state table survives destroys, as `jmap_contact_states` already does for REST).

## Verification

Lifecycle contract test mirroring `JmapClientContractTest`; `composer done-gate`; OpenAPI (`openapi/schemas/jmap/*`) + `jmap-envelope.md` dispatch rows. Full plan: [plan.md](./plan.md).
