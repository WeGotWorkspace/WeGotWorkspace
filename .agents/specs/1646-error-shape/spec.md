Source: #1646 (body-hash: 0ae61ff5)

# One error shape from the server to the screen

## Goal

Every API error that reaches a client over HTTP goes through one backend type and one render hook, and the written contract describes the body the code really sends. On the client, errors that leave `packages/apps/src/lib/api` share one typed base with a guard, so callers classify on `status` and `code`, never on text.

The work is a refactor. No response body a client parses changes, and no text a user can see changes.

## Non-goals

- Changing the value of `error` on any route. The realtime routes (Meet, Collab, Principal presence) put a machine code in `error` and a sentence in `message`; the clients read `error` first. That stays.
- Internal signals that never become an HTTP body on their own: `JmapMethodException`, `FileNodeSetError`, `RtcSignalingException`, `StorageFullException`, `BlobTooLargeException`, `PartMismatchException`, `FolderZipAborted`, `DriveNotFoundException`, `DriveAccessDeniedException`, `YjsPayloadException`, `InvalidOutboundMessageException`. Each is caught and rewrapped before HTTP (see plan, What exists).
- Protocol-mandated bodies: OAuth (`CimdException` → `{ error, error_description }`, RFC 6749), JMAP problem details (RFC 8620 / RFC 7807), Sabre DAV XML (`CardUidConflict`, `TooManyAttempts`), MCP tool errors (`McpExternalShareRefused`), and the installer wizard result (`DataDirRejected` → `{ ok, error, error_code, state }`).
- Controllers that return `response()->json(['error' => …])` directly instead of throwing. Listed as a follow-up, not changed here.
- User-facing error text, toasts, and when to use toast vs inline vs `onError`. Product choices; listed for Wouter.
- A client error-reporting endpoint. Decision recorded in plan.md, nothing built.

## Affected packages

- packages/api (chunk A)
- packages/apps (chunk B)
- `.agents/skills/api/rest-design.md`, `.agents/skills/client-transport/SKILL.md`

## Technical constraints

- One render hook in `packages/api/bootstrap/app.php` for every exception that renders as an API error. It is typed on a contract (`App\Exceptions\RendersApiError`), not on a concrete class.
- `ApiHttpException` keeps its constructor and its body `{ error: <sentence>, code?: <machine code> }`. About 490 throw sites depend on it.
- The three `<Domain>ResponseException` classes become one `RealtimeApiException` with a typed constructor (status, machine code, optional message). The free-form `payload` array goes away. Body: `{ error: <machine code>, code: <machine code>, message?: <sentence> }`. `code` is new and always equals `error`; `error` and `message` keep their exact values.
- Logging stays as it is in chunk A: the realtime exceptions are still reported by Laravel's handler and `ApiHttpException` is still not (Symfony `HttpException`). See plan.md, Logging decision.
- OpenAPI `Error` schema (`{ error, code? }`) already allows the added `code`; a `message` property is added to it so the documented schema covers realtime bodies.
- Client: the base class must not set `name`, so `String(error)` and every displayed message stay byte-identical for existing subclasses.

## Edge cases

- `RtcSignalingException` payloads that already carry `code` (`peer_id_taken`) keep `code === error`.
- `FilesController::resolveRoom` catches the realtime exception from the collab join check and turns it into a 404 `ApiHttpException`; that catch keeps working.
- A Laravel render callback typed on an interface is matched with `instanceof`, so `ApiHttpException` (extends `HttpException`) and the realtime base (extends `RuntimeException`) both hit the same hook before the catch-all `Throwable` hook.
