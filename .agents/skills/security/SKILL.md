---
name: security
description: Attacker-shaped checklist for pre-auth paths, uploads and parsers of caller-supplied input, and cache or limiter keys derived from that input. Use before implementing any of those.
---

# Security

Required before implementing any of these:

- a pre-auth code path
- an upload or a parser of caller-supplied input
- a cache key or limiter key derived from caller-supplied input

[Product#44](https://github.com/WeGotWorkspace/Product/issues/44) (guest comments, anonymous write path) is the first application already in the pipeline.

Read the [SSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html) before a caller-chosen URL is fetched. It covers shared address space and embedded addresses, which a hostname allowlist misses. Read the [Application Security Verification Standard](https://owasp.org/www-project-application-security-verification-standard/) for authentication and rate limiting. The list below is only the repo-specific remainder, including pre-auth middleware order.

## Checklist

Answer each item in the handoff. A happy-path test does not answer them.

- What is the rate-limit or cache key, and can the caller mint new keys (wildcard DNS, a spoofed header, a new origin)?
- Does a cap live only on a service instance? PHP-FPM builds a new process per request, so that cap resets. Count from the durable record or from shared cache, and test a second request. If the record or the address cannot be read, refuse the send.
- Does the limit run before the expensive work?
- Is the body streamed with a cap, or buffered fully and then rejected? An application cap does not undo a SAPI buffer (`enable_post_data_reading`, `post_max_size`).
- Which hosts does `filter_var` or the allowlist still accept? Parse IP literals with `inet_pton`, including expanded IPv4-mapped IPv6. A regex of one or two spellings leaves the others for `filter_var` to treat as "already an IP, so allowed."
- Does a pre-auth middleware run the limit and the size cap before the handler reads the body?
- Is there a test that tries the bypass, not only the happy path?
- When a caller may create only one kind of row, do updates and revokes select that same kind? Checking the request and then writing the newest row lets a guest or public share be changed through a member-only tool.
- Does a hash or allowlist in a response header come from the bytes the client receives? A build artifact a later step replaces is a different document.
- Do security headers that only PHP sets also exist for files the web server serves itself? `Header set` misses 304 responses; use `Header always set`. When TLS ends at a proxy, do not copy `X-Forwarded-Proto` into the `HTTPS` variable: `Request::isSecure()` reads that name and skips `trustProxies`.
- Does an unauthenticated report endpoint log at warning on the default channel? Browser noise hides real failures. Use a separate channel, and rotate it.
- Reissuing a time-limited secret must rotate the value and the expiry. A resend that returns the stored secret hands out a credential the accept path already rejects.
- A permission update must not rotate a live invite. Only the resend path rotates a token that still accepts. An already-expired token may be replaced; the caller does not receive that replacement unless the route is a resend.
- Do not allowlist a secret-shaped string this change introduces. Rewrite the commit while it is still off the default branch. A global allowlist regex hides that string in every future file.
- Decrypting a stored secret while building a list must fail that row only. One undecryptable record must not fail the whole response.
- Does a test that claims to prove work after the response leave `defer()` enabled? `withoutDefer()` invokes the callback inside `offsetSet`, before the response exists, so the assertion passes with that control turned off. `MakesHttpRequests::call()` already runs `InvokeDeferredCallbacks` during `terminate()`.
- When the same mutation is allowed on REST and judged by a live-update guard, is the allow predicate the same for each field, including how user ids are compared?
- Does a public redaction drop only the private values it recognizes? Unknown classification is private. Strip the properties the writer emits by the writer's list, and test the property the writer adds.
- Does a 429 reach the client as `rate_limited` with the exception's `Retry-After` (and the other throttle headers)? The catch-all renderer must not map it to `server_error` or build a fresh response that drops those headers.
- Does the order test use the sorted pipeline (`Router::gatherRouteMiddleware`), not `Route::gatherMiddleware()`? Declared order stays green when the priority sort moves the limiter in front of auth and the key falls back to the client address.
- Does every entry that reaches the expensive call share the cap (HTTP rules and MCP tool rules), with the service check as the last line? An offset on a query that sorts with per-row work needs a ceiling. Clamping it and setting `hasMore` false stops a scroll; rejecting it with 400 breaks clients that page until `hasMore` is false. Skipping rows does not skip the scan.
- A long-lived refresh credential must not be readable by script. Put it in an HttpOnly cookie scoped to the endpoints that redeem it, and test that a body-supplied copy is ignored. A rejected cookie must be cleared so the browser does not present a dead token forever.
- Does a Sabre plugin read or write state for a write before the server authorizes it? `beforeMethod:*` below priority 20 runs before DAVACL, and every `beforeMethod` runs before the `If-Match` preconditions and lock tokens. Read or record on `beforeWriteContent` / `beforeCreateFile`, and test that a refused write leaves nothing behind.

A security finding is promoted into this skill on the first occurrence. See [review-findings.md](../../review-findings.md).
