# Review findings

Intake for recurring review findings. Skills and lints are the memory. This file is the inbox.

Before planning, and before a security or invariant chunk, read **Active** rows (`promoted-to` empty).

When review feedback arrives, append one English line per new recurring finding, then fix. A plan review counts. `promoted-to` may be [plan-feature](skills/plan-feature/SKILL.md). A finding that shows up twice is promoted into a skill or lint. A security finding is promoted on the first occurrence. Do not let this file become a second policy. [code-review](skills/code-review/SKILL.md) does not re-check promoted rows.

This intake is new. After a few weeks, check whether unpromoted findings shrink, or whether the same mistakes only move. Do not add a tracking system for that check.

## Active

- 2026-10-06: A path rewrite can carry a grant into a location that must not grant access (a share followed its folder into product trash and stayed live).
- 2026-10-07: A plan that leaves a write path as a hard delete must name every caller, not only the UI that stopped using it (MCP `deleteItems` hard-deleted a grantee's shared file).
- 2026-10-13: A `LIKE ... ESCAPE '\\'` clause is valid on SQLite and a syntax error on MySQL. The PHP string becomes `ESCAPE '\'`, which MySQL reads as an escaped quote.
- 2026-10-13: A migration `down()` that drops the only ciphertext copy is not a rollback. Restore the plaintext first, or say in the migration that `down()` is one-way.
- 2026-10-13: Token hash helpers in one change must normalize the same way. Tests call the helper; a copied `hash()` stops tracking the implementation.
- 2026-10-13: An encrypted column with both a cast and a manual decrypt reader has two failure modes. App code reads through the helper named on the property.

## Promoted

| Date | Finding | Example | Promoted to |
|------|---------|---------|-------------|
| 2026-10-13 | A guard checked the request and then updated the newest row | MCP `drive.share` could raise an existing guest share to `full` | [security/SKILL.md](skills/security/SKILL.md) |
| 2026-09-28 | A green suite did not pin the old contract | Notes YAML stars; a cross-boundary `openapi.json` input can hash wrong while typegen stays green | [testing/test-first.md](skills/testing/test-first.md) |
| 2026-09-28 | A security control matched the letter and missed the bypass | Rate-limit key the caller can mint; body buffered before the size cap | [security/SKILL.md](skills/security/SKILL.md) |
| 2026-10-13 | An IP-literal check that matches one or two spellings lets the same address through in another spelling | Expanded `::ffff:` forms passed `filter_var` after the regex missed them | [security/SKILL.md](skills/security/SKILL.md) |
| 2026-10-13 | A REST allow and a live-update drop for the same field split a session | A commenter resolving their own doc thread persisted on REST and was dropped on the mesh | [security/SKILL.md](skills/security/SKILL.md) |
| 2026-10-13 | A per-entity cap stored on a service instance resets on the next PHP-FPM request, and an unreadable address skipped the cap | iMIP distinct-recipient set lived on `CalendarSchedulingService` and failed open | [security/SKILL.md](skills/security/SKILL.md) |
| 2026-09-28 | An unresolved choice was treated as decided during implementation | The same choice left open across review rounds | [plan-feature/SKILL.md](skills/plan-feature/SKILL.md) |
| 2026-09-28 | A rewrite dropped a decided section without saying so | A later draft removed a previously decided section | [plan-feature/SKILL.md](skills/plan-feature/SKILL.md) |
| 2026-09-28 | Plan or tasks status was cited as proof | A checklist counted complete while items were not planned | [verify-issue/SKILL.md](skills/verify-issue/SKILL.md) |
| 2026-09-28 | A premise about code, a dependency, or issue status had no source that supports it | #525 blocked on room IDs the Goal did not need; #568 depending on #566 when it did not | [plan-feature/SKILL.md](skills/plan-feature/SKILL.md) |
| 2026-09-28 | A chunk boundary was not shippable on its own | A half-landed stack broke the build; a chunk broke the old client until a later chunk | [plan-feature/SKILL.md](skills/plan-feature/SKILL.md) |
| 2026-09-28 | Infra or config could fail quietly with no signal | Cross-boundary `openapi.json` hash stays green; a runtime image with unpinned versions | [plan-feature/SKILL.md](skills/plan-feature/SKILL.md) |
| 2026-09-28 | Work drawn from a budget did not name what it displaces | The install matrix grew inside the #584 budget; a chunk was not on the sprint plan | [plan-feature/SKILL.md](skills/plan-feature/SKILL.md) |
| 2026-09-28 | The first design did not name the existing component it could have used | A new component chosen where one already provides the behavior | [plan-feature/SKILL.md](skills/plan-feature/SKILL.md) |
| 2026-10-13 | A CSP hash was taken from HTML the server never sends | Vite `dist/index.html` hashed; runtime `index.html` is generated without that script | [security/SKILL.md](skills/security/SKILL.md) |
| 2026-10-13 | Security headers set only in PHP miss static responses, and `Header set` misses 304 | HSTS absent on Apache-served `index.html`, `sw.js`, and assets | [security/SKILL.md](skills/security/SKILL.md) |
| 2026-10-13 | An open report endpoint logged warnings on the default channel | CSP reports would bury the error channel GlitchTip reads | [security/SKILL.md](skills/security/SKILL.md) |
| 2026-10-13 | Copying X-Forwarded-Proto into the HTTPS variable bypasses trustProxies | Static HSTS behind a TLS proxy must use a separate env name | [security/SKILL.md](skills/security/SKILL.md) |
| 2026-10-13 | A resend of a time-limited secret returned the stored value | An expired drive invite stayed pending and the owner received a token accept rejects | [security/SKILL.md](skills/security/SKILL.md) |
| 2026-10-13 | A secret-scanner allowlist covered a string introduced in the same unmerged history | A global gitleaks `regexes` entry for a share-invite fixture that a later commit already replaced | [security/SKILL.md](skills/security/SKILL.md) |
| 2026-10-13 | Decrypting ciphertext inside a list serializer failed the whole response | One drive share with a bad `APP_KEY` cipher returned 500 for the owner share list | [security/SKILL.md](skills/security/SKILL.md) |
| 2026-10-13 | A permission merge reused the invite resend path and rotated a live token | PATCH shareWith on a pending guest replaced the emailed link and did not return the new token | [security/SKILL.md](skills/security/SKILL.md) |
| 2026-10-13 | A feature test that calls `withoutDefer()` runs deferred work inline, so a green HTTP assertion does not prove a control that waits until after the response | Password reset enumeration tests swapped defer off in `setUp()` | [security/SKILL.md](skills/security/SKILL.md) |
| 2026-10-13 | A rate-limit response mapped to `server_error` and dropped `Retry-After` | Catch-all renderer treated 429 as an internal error and built a fresh response | [security/SKILL.md](skills/security/SKILL.md) |
| 2026-10-13 | A middleware-order test read the declared list, so the priority sort could run the limiter before auth | `Route::gatherMiddleware()` stayed green when throttle moved ahead of `wgw.auth` and keyed on the address | [security/SKILL.md](skills/security/SKILL.md) |
| 2026-10-13 | A cost cap lived on one entry and not the others | Search length differed between the HTTP rule and the service, MCP tools had no max, and offset was unbounded | [security/SKILL.md](skills/security/SKILL.md) |
