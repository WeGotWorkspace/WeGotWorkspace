---
name: security
description: Attacker-shaped checklist for pre-auth paths, uploads and parsers of caller-supplied input, and cache or limiter keys derived from that input. Use before implementing any of those.
---

# Security

Required before implementing any of these:

- a pre-auth code path
- an upload or a parser of caller-supplied input
- a cache key or limiter key derived from caller-supplied input

[#546](https://github.com/WeGotWorkspace/wegotworkspace/issues/546) (guest comments, anonymous write path) is the first application already in the pipeline.

Read the [SSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html) before a caller-chosen URL is fetched. It covers shared address space and embedded addresses, which a hostname allowlist misses. Read the [Application Security Verification Standard](https://owasp.org/www-project-application-security-verification-standard/) for authentication and rate limiting. The list below is only the repo-specific remainder, including pre-auth middleware order.

## Checklist

Answer each item in the handoff. A happy-path test does not answer them.

- What is the rate-limit or cache key, and can the caller mint new keys (wildcard DNS, a spoofed header, a new origin)?
- Does a cap live only on a service instance? PHP-FPM builds a new process per request, so that cap resets. Count from the durable record or from shared cache, and test a second request. If the record or the address cannot be read, refuse the send.
- Does the limit run before the expensive work?
- Is the body streamed with a cap, or buffered fully and then rejected?
- Which hosts does `filter_var` or the allowlist still accept?
- Does a pre-auth middleware run the limit and the size cap before the handler reads the body?
- Is there a test that tries the bypass, not only the happy path?
- Reissuing a time-limited secret must rotate the value and the expiry. A resend that returns the stored secret hands out a credential the accept path already rejects.
- A permission update must not rotate a live invite. Only the resend path rotates a token that still accepts. An already-expired token may be replaced; the caller does not receive that replacement unless the route is a resend.
- Do not allowlist a secret-shaped string this change introduces. Rewrite the commit while it is still off the default branch. A global allowlist regex hides that string in every future file.
- Decrypting a stored secret while building a list must fail that row only. One undecryptable record must not fail the whole response.
- Does a test that claims to prove work after the response leave `defer()` enabled? `withoutDefer()` invokes the callback inside `offsetSet`, before the response exists, so the assertion passes with that control turned off. `MakesHttpRequests::call()` already runs `InvokeDeferredCallbacks` during `terminate()`.
- When the same mutation is allowed on REST and judged by a live-update guard, is the allow predicate the same for each field, including how user ids are compared?

A security finding is promoted into this skill on the first occurrence. See [review-findings.md](../../review-findings.md).
