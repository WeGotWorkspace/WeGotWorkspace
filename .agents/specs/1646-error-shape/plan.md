# One error shape from the server to the screen

Derived from [spec.md](./spec.md).

## Goal

See [spec.md](./spec.md#goal): one backend render path for API errors, a written contract that matches it, and one typed client error base in `lib/api`, with no change to any parsed body or visible text.

## Budget

Technical debt milestone. Displaces nothing on the pioneer track.

## Non-goals

See [spec.md](./spec.md#non-goals).

## What exists

- `ApiHttpException` renders `{ error, code? }` from its own hook. `path: packages/api/bootstrap/app.php:118`
- `MeetResponseException`, `CollabResponseException`, `PrincipalResponseException` each extend `RuntimeException`, carry `(int $status, array $payload)`, and have their own identical hook that dumps `payload`. `path: packages/api/bootstrap/app.php:109`
- Their throw sites always pass `['error' => <machine code>]` plus an optional `'message' => <sentence>`; the signaling wrappers forward `RtcSignalingException::$payload`, whose only other key is `code` on `peer_id_taken` (equal to `error`). `path: packages/api/app/Services/Rtc/Signaling/HttpSignalingStore.php:316`
- The signaling client reads `data.error || data.message`. `path: packages/apps/src/lib/rtc/signaling/http-client.ts:203`
- The Meet REST client reads `payload.error ?? payload.message`. `path: packages/apps/src/lib/api/wgw/meet.ts:27`
- `RtcSignalingException` never reaches HTTP: Meet, Collab and Principal signaling services rewrap it in `run()`. `path: packages/api/app/Services/Meet/MeetSignalingService.php:628`
- The other bespoke exceptions are caught and rewrapped (`ApiHttpException`, `JmapProblem`, an OAuth body, an installer result, or an MCP tool error) before HTTP. `path: packages/api/app/Http/Controllers/Api/V1/Files/FilesController.php:334`, `path: packages/api/app/Http/Controllers/Api/V1/Jmap/JmapBlobController.php:120`, `path: packages/api/app/Http/Middleware/ResolveCimdClient.php:33`, `path: packages/api/app/Services/Installer/InstallerWizardService.php:148`, `path: packages/api/app/Http/Requests/Api/V1/NotePatchRequest.php:53`
- `rest-design.md` says the stable error shape is `error`, `message`, HTTP status. `path: .agents/skills/api/rest-design.md:56`
- OpenAPI `Error` schema is `{ error (required), code }`. `path: packages/api/openapi/openapi.json`
- Client: `WgwRequestError(message, status)` exists; `NotesRequestError`, `TasksRequestError`, `ContactsRequestError`, `MeetChatRequestError`, `NotesVjournalRequestError`, `DriveTransportError`, `CollabHttpError`, `HttpSignalingError` each re-declare `status` (some `code`) on a plain `Error`. `path: packages/apps/src/lib/api/wgw/request-error.ts:6`

## Considered

- Replace the three domain classes with `ApiHttpException` plus a named constructor — rejected. `ApiHttpException` puts the sentence in `error`; the realtime clients read the machine code from `error`. One class with two body layouts behind a flag hides the difference instead of naming it.
- Rewrite realtime bodies to `{ error: <sentence>, code }` — rejected. Every realtime client reads `error` first and matches codes such as `unknown_peer` and `relay_unavailable` on it; that is a breaking wire change.
- An abstract base class that `ApiHttpException` also extends — rejected. `ApiHttpException` must stay an `HttpException` (Laravel does not report it; the catch-all hook reads its status and headers) and the realtime classes are `RuntimeException`s that Laravel reports today. An interface lets both meet in one hook without changing either parent.
- Keep the three domain classes vs. merge them into one — kept. Their names are what callers catch (`FilesController` catches `CollabResponseException`) and what a reader greps for. Their bodies are now empty; the shared parent holds the logic.

## Affected packages

- packages/api | packages/apps | .agents/skills

## Dependencies

1. Chunk A (backend) lands first; it is independent of the client.
2. Chunk B (client) builds on main after A, or in parallel: it does not read the new `code` field.

## Open decisions

None — every choice for this work is made. Choices that change visible behaviour are listed under Decisions for Wouter and are out of scope.

## Logging decision

Today Laravel reports (logs at `error`, with a stack trace) every realtime 4xx such as `auth_required`, `unknown_peer` or `rate_limited`, because the three domain classes are `RuntimeException`s. `ApiHttpException` 4xx and 5xx are never reported, because Laravel skips `HttpException`.

Chunk A keeps both as they are: the render path changes, the report path does not. Aligning them is a logging change in its own right and belongs with #1634's rule ("warning = designed limit or rejected input"). Proposed follow-up on #1634: realtime 4xx stop being reported; realtime 5xx (`relay_unavailable`, `files_disabled`) stay reported.

Client-side trace (issue proposal 4): declined for now, nothing built. A self-hosted install cannot assume a third-party reporter, and an opt-in client log endpoint is a product choice (what is collected, who reads it, retention). Listed for Wouter.

## Decisions for Wouter

- Client error reporting: build an opt-in client error log the admin can read, or keep declining.
- Toast vs inline vs `onError`: written into `apps-ui` ("Showing an error") as a description of current practice, with no UI change. Wouter reviews the rule; changing any surface is a separate product change.
- User-facing text that today shows a raw server code (the Meet REST client shows `payload.error`, which on realtime routes is a code such as `forbidden`). Changing that is a copy change.

## Invariants

- No body a client parses changes: on every realtime route, `error` and `message` keep their exact values, and the only change is the added `code`. Proof: `path: packages/api/tests/Feature/Errors/ApiErrorRenderTest.php`.
- `ApiHttpException` bodies are unchanged. Proof: `cmd: composer --working-dir packages/api done-gate` (existing feature tests assert `error`/`code` across domains).
- Laravel reports the realtime exceptions as before and does not report `ApiHttpException`. Proof: `path: packages/api/tests/Feature/Errors/ApiErrorRenderTest.php` assertion `test_realtime_errors_are_still_reported_and_api_http_errors_are_not`.
- Client: no displayed message or `String(error)` changes. Proof: `path: packages/apps/src/lib/api/api-error.test.ts`.

## Chunks

### Chunk A: Backend error shape

- **id:** `chunk-a-api-error-shape`
- **Skill:** api
- **Inputs:** `path: packages/api/bootstrap/app.php:109`
- **Done when:** one render hook typed on `RendersApiError`; `ApiHttpException` and `DomainResponseException` implement it; the three domain classes extend `DomainResponseException` with a typed constructor; `rest-design.md` and the OpenAPI `Error` schema match; feature tests cover each affected endpoint group.
- **Verify with:** `composer --working-dir packages/api done-gate`
- **Parallel with:** `chunk-b-client-api-error`

### Chunk B: Client typed errors

- **id:** `chunk-b-client-api-error`
- **Skill:** client-transport
- **Inputs:** `path: packages/apps/src/lib/api/wgw/request-error.ts:6`
- **Done when:** `lib/api` exports `ApiError` (`status`, `code?`) and `isApiError()`; the status-carrying `*RequestError` classes extend it without changing `name` or `message`; the client-transport skill names both; every remaining bare `throw new Error(` in `lib/api` is either converted where the status is already known and the outbox bucket cannot change, or listed in the PR with its reason.
- **Verify with:** `pnpm test:apps-done-gate`
- **Parallel with:** `chunk-a-api-error-shape`

## Test plan

- [ ] API: feature test per affected endpoint group (Meet rooms REST, room sessions for meet/collab/principal, collab document) asserting the exact body → implement → `composer done-gate`
- [ ] UI: Vitest for `ApiError`/`isApiError` and for unchanged `name`/`message` on each subclass → `pnpm test:apps-done-gate`
- [ ] Browser smoke: Meet join, a Docs collaborative document, presence on Home.
