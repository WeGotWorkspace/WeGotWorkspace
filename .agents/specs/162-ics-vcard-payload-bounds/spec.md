Source: #162 (body-hash: a87fa3a2)

# ICS/vCard payload bounds

Technical translation of GitHub issue #162. Parent context: JMAP REST (#132 / epic #137).

## Goal

Reject oversized or overly complex ICS/vCard **objects** before they can tie up a worker. Whole-calendar and whole-address-book imports stay partial: one bad object is reported in `errors[]`; siblings can still be stored.

`VObjectPayloadGuard` keeps the per-object defaults: **512 KiB** (`524288`) for one vCard or one ICS object, **64** combined nested `VEVENT`+`VTODO`+`VALARM` components (excluding `VTIMEZONE` / `STANDARD` / `DAYLIGHT`), **512** vCard properties. Single-object REST writes stay HTTP **413** `payload_too_large` / **400** `bad_request`. Warning log `vobject_payload_rejected` on write paths omits the raw blob.

## Non-goals

- Changing the per-object 512 KiB, 64, or 512 constants
- Raising the calendar import body above `MAX_ICS_BYTES` (512 KiB) in this issue — see follow-up
- A production-visible signal for over-cap stored objects (debug on read hides them) — see follow-up
- Component-capping webcal feeds (`readICalendarFeed` stays size-only)
- HTTP 413 from `POST /jmap`
- Notes, chat, docs, or blob upload limits
- Renaming `post_too_large` or changing Drive-upload error handling
- Filtering JMAP `query` or any query response that reports `total`

## Affected packages

- `packages/api` (guard, import/set/get/list paths, OpenAPI, tests, parity doc)
- `packages/openapi-types` (regenerated types)

## Technical constraints

### Component cap is per stored object / UID group

A Google or Apple calendar export often has hundreds of `VEVENT`s. Applying the cap of 64 to the whole ICS would 400 every realistic import. Byte-check the **whole** calendar import body against `MAX_ICS_BYTES` (512 KiB), then byte-check **each UID group** (serialized) against 512 KiB and count components per group. A group over either cap is a per-item `errors[]` entry with the guard `code` and message; other groups still import.

**Calendar import body stays 512 KiB on purpose.** Large calendar exports already fail with **413** at that limit; that is existing behavior, not a regression of #162. Contact import is raised because a photo address book is larger than one card.

### Contact import uses two caps

- Whole-request cap: **8 MiB** (`8388608`) by default from config (`config/wgw.php`). Over that → **413** `payload_too_large` before any card parse. Feature tests set the config to **64 KiB** and post a slightly larger body (do not post a real 8 MiB + 1 body).
- Effective limit is **min(8 MiB, post_max_size)**. Leave `post_too_large` unchanged (`WgwOversizedPost`, bootstrap 413 branch, `abortIfExceeded`). OpenAPI documents both codes; clients treat them as the same limit.
- Parse cards one at a time (`splitVcards` or Sabre `Splitter\VCard`). Never `Reader::read` on the whole body.
- A single card over 512 KiB or 512 properties is a per-item error with the guard code/message. `catch (\Throwable)` must not replace guard codes with `"Invalid vCard block."`.

### JMAP SetError is `tooLarge`

Map `payload_too_large` and the guard’s component/property `bad_request` to RFC 8620 `tooLarge`, keeping the guard message in `description`. `POST /jmap` stays HTTP 200. Not `invalidProperties` / `invalidArguments`.

### Reading an over-cap stored object must not blank the collection

- **JMAP `get`:** over-cap id → `notFound`; other ids returned; log at **debug**
- **JMAP `query`:** unchanged (still returns the over-cap id). Same for REST queries with `total` (e.g. `POST /tasks/items/query`)
- **REST list without `total`:** `GET /tasks/items` omits the over-cap task, stays 200, log at **debug**
- **REST single GET:** **413** `payload_too_large` (stored object, not request body)

### Logging

Write paths (import and set): `vobject_payload_rejected` at **warning**. Read paths: same event at **debug**. Fields: `domain`, `kind`, `actual`, `limit`, plus `principal` when username is known. No raw blob, no HTTP route.

## Edge cases

- Nested `VALARM` under `VEVENT`/`VTODO` counts toward the 64 cap; `VTIMEZONE` with `STANDARD`/`DAYLIGHT` does not
- `getComponents($name)` currently ignores the name and triple-counts direct children while missing nested alarms — replace with a nested walk
- Mixed calendar: seed the over-cap object via `seedEventViaPdo` (not REST/JMAP); query returns both ids; get returns the normal object and `notFound` for the over-cap id
- Read-path debug hides an over-cap object from admins while CalDAV clients still sync it

## Follow-up (not this issue)

[#931](https://github.com/WeGotWorkspace/wegotworkspace/issues/931) covers:

1. `MAX_ICS_IMPORT_BYTES` so a large calendar export is not rejected at 512 KiB
2. A visible signal for over-cap objects (one warning per object id, an admin count, or a UI notice)
