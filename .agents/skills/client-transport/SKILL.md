---
name: client-transport
description: Error contract for the client transport layer in packages/apps/src/lib/api — typed errors carrying an HTTP status, so the offline outbox can classify failures. Use when adding or changing calls in lib/api/wgw or error handling in lib/offline.
paths:
  - "packages/apps/src/lib/api/**"
  - "packages/apps/src/lib/offline/**"
---

# Client transport

`packages/apps/src/lib/api/` is the client transport layer. `packages/apps/src/lib/offline/` classifies the errors that leave it: a failed outbox mutation is transient, permanent (403 or 404), or a conflict. That choice decides whether the user sees a toast that keeps asking to try again later.

## Rule

An error that leaves the transport layer carries an HTTP status. A bare `Error` whose text the caller must interpret is not that contract.

- A real HTTP failure is an `ApiError` (`lib/api/api-error.ts`): `status: number` and, when the client parsed the `{ error, code? }` body, `code`. Throw `WgwRequestError(message, res.status)` for a plain WeGotWorkspace request, or a domain subclass (`ContactsRequestError`, `TasksRequestError`, `NotesRequestError`, `NotesVjournalRequestError`, `MeetChatRequestError`, `DriveTransportError`, `ShareSessionError`, `CalendarImportError`, `CollabHttpError`, `HttpSignalingError`) when callers need to tell them apart. Check with `isApiError(error)` or `instanceof` on the subclass. `ApiError` sets no `name`; a subclass that had a name keeps it.
- A new error class for an HTTP failure extends `ApiError`. Do not re-declare `status` or `code` on the subclass: the build defines class fields, so a re-declared field resets the value `super()` set.
- `JmapRequestError` (`lib/jmap-client`) is the exception: a JMAP request can fail before any status exists, so its `status` is optional and it does not extend `ApiError`.
- A JMAP `/set` rejection has no HTTP status. `httpStatusFromFlushError` (`lib/offline/core/outbox-error-status.ts`) translates it. When a new `setError.type` is permanent, add it to that mapping. Do not add a regex at the caller.
- A condition that locally means "does not exist" or "no access", such as a failed path resolution, is also a status (`404` or `403`). Throw a typed error.

## Bare `Error` in `lib/api`

A bare `throw new Error(` is left only where no status exists or where adding one would change what a caller does:

- Programmer and input assertions (missing argument, guest operation that is not offered, missing config).
- Failures with no HTTP status: unexpected JSON shape, a JMAP `SetError`, a missing blob id, an app turned off in settings.
- Seven HTTP failures whose callers classify on status, where a new status would change behaviour the user sees: `drive.ts` star writes and `/files/starred` (the Drive and Docs outbox flush would treat a 409/412 as a state mismatch), guest `/files/children` (the folder listing would start auto-retrying 5xx), `drive-shares.ts` `getShareJson` (same two effects), `calendar-scheduling.ts` `throwUnlessSchedulingOk` (a 403 RSVP would become a permanent outbox failure), and `http.ts` `readTokenResponse` (dev auto-login). Converting them is a behaviour change: decide it per site with the outbox and listing owners.

## Do not classify on the message

Never classify a failure from the contents of `error.message`. The regex fallback in `isPermanentOutboxFailure` (`lib/offline/core/outbox-store.ts`) exists only for outbox rows already stored in IndexedDB before `lastStatus` existed. It is a migration path. Do not copy it, and do not widen it.

**Lint:** `messageClassificationRules` in [`packages/apps/eslint.config.js`](../../../packages/apps/eslint.config.js) fails CI in `lib/api/**` and `lib/offline/**` (tests excluded) when code calls `.includes`, `.startsWith`, `.match` and similar on `.message` or an outbox row's `.lastError`, runs a regex `.test`/`.exec` on them, or does either on a local named like a message (`message`, `msg`, `*Message`). It does not follow every alias, so review still applies. Reviewed exceptions carry an `eslint-disable-next-line no-restricted-syntax` with a reason:

- `isPermanentOutboxFailure` — the migration path above.
- `isFetchNetworkError` (`lib/offline/core/browser-online.ts`) — a fetch that never reached a server has no HTTP status; the browser's `TypeError` text is the only signal.
- The `precondition failed` fallback in `lib/offline/docs/docs-outbox-flush.ts` and `lib/offline/drive/drive-outbox-flush.ts` — some Drive REST writes in `lib/api/wgw/drive.ts` still throw an `Error` without a status. Remove the fallback once they throw a typed error.

## Why the status matters

Without a status, a mutation for a file the server has already removed lands in the transient bucket. The client retries it without end, and the toast keeps saying to try again later.

## REST that stays

Some REST in this layer is intentional. Do not treat these calls as unfinished JMAP work:

- Guest shares (`createGuestWgwDriveOperations`). A guest has no principal. REST parity is the decision in [#990](https://github.com/WeGotWorkspace/wegotworkspace/issues/990).
- `/files/star` is a WeGotWorkspace extension and has no JMAP method.
- `/jmap/upload` and `/jmap/download` are the RFC 8620 blob endpoints. Those calls are JMAP.

This skill covers the boundary between `lib/api` and `lib/offline`. It does not cover general error handling in the UI.
