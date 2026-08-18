Source: ad-hoc

# Contacts app → JMAP envelope

Technical translation of Chunk B from the JMAP REST sunset plan. No GitHub Task yet (parent files the Epic after the five PRs exist).

## Goal

The contacts app talks to `AddressBook/*` and `ContactCard/*` on the existing JMAP envelope (`/jmap/session`, `/jmap`, `/jmap/upload`, `/jmap/download`). Dual-protocol REST list/get/set/changes/query and `GET …/vcf` go away on the apps side. vCard **import** stays on `POST /contacts/cards/import`.

## Non-goals

- Deleting `/contacts/*` routes (Chunk C)
- Rewriting import onto `ContactCard/set` (no RFC 9610 `ContactCard/import`; PHP VObject converter must stay)
- New query filters or sorts beyond what `JmapContactsClientContractTest` / `JmapContactsMethodsTest` already pin (`inAddressBook`, `uid`; no `kind`, no `sort`)
- Editing `packages/api`

## Affected packages

- packages/apps

## Technical constraints

- `JmapContactsClient` layers over existing `JmapClient` (copy `createCalendarJmapClient`: session `/jmap/session`, `wgwFetch` for auth)
- methodCalls must match the batches already pinned in `JmapContactsClientContractTest` (including `#ids` ResultReferences)
- Export uses `contacts-vcard-export.ts` (client-side JSContact → vCard)
- `contacts-vcard-import.ts` stays file batching only; `operations.importVcards` still POSTs `/contacts/cards/import`

## Edge cases

- Per-item `ifInState` on update still passes through `ContactCard/set` update objects (legacy set service). Destroy is a JMAP id list — per-item destroy `ifInState` cannot be sent.
- Stale IndexedDB REST sync tokens (`"0"`, bare integers) must full-resync when `/changes` returns `cannotCalculateChanges`.
- Offline hybrid already refuses import; export must not require `GET …/vcf`.
