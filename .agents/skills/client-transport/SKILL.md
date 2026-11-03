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

- A real HTTP failure is an error class with a `status: number` field. `ContactsRequestError`, `TasksRequestError`, `NotesVjournalRequestError`, and `JmapRequestError` already follow this.
- A JMAP `/set` rejection has no HTTP status. `httpStatusFromFlushError` (`lib/offline/core/outbox-error-status.ts`) translates it. When a new `setError.type` is permanent, add it to that mapping. Do not add a regex at the caller.
- A condition that locally means "does not exist" or "no access", such as a failed path resolution, is also a status (`404` or `403`). Throw a typed error.

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
