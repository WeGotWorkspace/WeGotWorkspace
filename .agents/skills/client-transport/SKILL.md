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

- A real HTTP failure is an `ApiError` (`lib/api/api-error.ts`): `status: number` and, when the client parsed the `{ error, code? }` body, `code`. Throw `WgwRequestError(message, res.status)` for a plain WeGotWorkspace request, or a domain subclass (`ContactsRequestError`, `TasksRequestError`, `NotesRequestError`, `NotesVjournalRequestError`, `MeetChatRequestError`, `DriveTransportError`, `DriveUploadPartRejectedError`, `ShareSessionError`, `CalendarImportError`, `CollabHttpError`, `HttpSignalingError`, `WgwSessionRenewalError`, and the module-private `AuthHttpError` in `http.ts`) when callers need to tell them apart. Check with `isApiError(error)` or `instanceof` on the subclass. `ApiError` sets no `name`; a subclass that had a name keeps it.
- A new error class for an HTTP failure extends `ApiError`. Do not re-declare `status` or `code` on the subclass: the build defines class fields, so a re-declared field resets the value `super()` set.
- `JmapRequestError` (`lib/jmap-client`) is the exception: a JMAP request can fail before any status exists, so its `status` is optional and it does not extend `ApiError`.
- A JMAP `/set` rejection has no HTTP status. `httpStatusFromFlushError` (`lib/offline/core/outbox-error-status.ts`) translates it. When a new `setError.type` is permanent, add it to that mapping. Do not add a regex at the caller.
- A condition that locally means "does not exist" or "no access", such as a failed path resolution, is also a status (`404` or `403`). Throw a typed error.

## Failures without an HTTP status

Not every failure has a status. These stay out of `ApiError` on purpose, so the outbox keeps them in the transient bucket. Each sets no `name`, so `String(error)` reads as it did when it was a bare `Error`:

- `UnexpectedApiResponseError` (`lib/api/api-error.ts`): the server answered, but the client cannot use the answer. A body that is not JSON (`wgwReadJson`, the auth token response), a missing field the contract promises (created id, `blobId`, new state, `access_token`, download ticket URL, the FileNode capability), or a record that cannot be read back right after a write.
- `WgwGuestSessionMissingError` (`wgw/guest-session-missing-error.ts`): a guest request with no usable share session in this tab. No request was sent.
- `WgwAppDisabledError` (`wgw/app-disabled-error.ts`): the app is turned off in settings, so its bootstrap stops.
- `ContactSetRejectedError` (`wgw/contacts-set.ts`): a `Contact/set` SetError other than `stateMismatch`, with `setErrorType`.
- `JmapSetItemError`, `JmapMethodError` (`lib/jmap-client`) for JMAP method-level failures; see the `/set` rule above.

Pick one of these, or a domain class next to the call, for a new failure with no status. Do not throw a bare `Error` for it.

## Bare `Error` in `lib/api`

A bare `throw new Error(` is left only for a programmer or input assertion: a guard that fails before any request is sent, or an unreachable fallback. Each was reviewed (#1646):

- `drive.ts`: `GUEST_STRUCTURE_UNAVAILABLE` (4) and `GUEST_UPLOAD_UNAVAILABLE` (2), a guest operation the UI does not offer.
- `http.ts`: sign-in and password-reset argument guards (empty username or password, empty identifier, empty reset token, password shorter than 10 characters). The forms validate first; these keep the module safe when called directly.
- `admin.ts` `fetchAdminLiveBootstrap`: the line after the retry loop, which the loop never reaches (its last attempt rethrows).
- `drive-create-keep-both.ts`: the keep-both loop ran out of attempts. Each attempt picks a name that the fresh sibling list says is free, so only a server that keeps answering `alreadyExists` gets here.
- `auth-token.ts`: missing credentials in the authenticated Storybook parity story.

Still bare, and not assertions: six HTTP failures whose callers classify on status, where a status changes behaviour the user can notice. `drive.ts` star writes (`DELETE` and `POST /files/star` through `postJson`) and `GET /files/starred` (the Drive and Docs outbox flush would treat a 409/412 as a state mismatch), guest `GET /files/children` (the folder listing would start auto-retrying 5xx), `drive-shares.ts` `getShareJson` (same two effects), and `calendar-scheduling.ts` `throwUnlessSchedulingOk` (a 403 RSVP would become a permanent outbox failure). They move in their own PR with the behaviour change written down.

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
