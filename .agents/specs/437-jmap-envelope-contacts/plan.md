# JMAP envelope: contacts — plan (draft)

Derived from [spec.md](./spec.md). Umbrella sequencing: [../000-jmap-envelope-multidomain/plan.md](../000-jmap-envelope-multidomain/plan.md).

## Dependencies

1. Umbrella chunk P (envelope decoupling) merged — this chunk must not re-hardcode capability lists or route gating.
2. May run parallel with the blobs chunk (coordinate on the session capability providers introduced by P).

## Chunks

### Chunk C: contacts envelope

- **Branch:** `feat/jmap-envelope-contacts`
- **Skill:** api
- **Inputs:** [spec.md](./spec.md); `AddressBookRepository` / `ContactCardRepository` / `ContactCardSetService` / `JmapContactStateService` (reuse unmodified); `JmapAccountStateCodec`; `CalendarEventSetMethod` as the normalization model; `docs/contacts/rfc9610-summary.md`.
- **Done when:**
  - `addressbookSyncTokens()` primitive feeds the codec;
  - `AddressBook/get|changes|set`, `ContactCard/get|changes|set|query` registered; `ContactCard/queryChanges` → `cannotCalculateChanges`;
  - adapters normalize legacy REST shapes (string-valued `created`/`updated`, snake_case SetError types) to RFC 8620; REST untouched;
  - top-level `ifInState` on `ContactCard/set` with account-wide codec states;
  - `media` blobIds resolve against `ContactBlobService` (deviation documented until the blobs chunk lands);
  - session advertises the RFC 9610 contacts capability; lifecycle contract test mirroring `JmapClientContractTest` incl. incremental post-write sync; mixed-domain batch test.
- **Verify with:** `composer done-gate`; OpenAPI + `jmap-envelope.md` updated.
- **Parallel with:** blobs chunk.

## Test plan

- [ ] `JmapContactsMethodsTest` per method; lifecycle contract test; mixed-domain batch test (spec §Edge cases)
- [ ] Post-write incremental sync regression (mismatch-13 replay)
- [ ] `composer done-gate`
