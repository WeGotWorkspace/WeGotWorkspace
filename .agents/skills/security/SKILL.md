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
- Does the limit run before the expensive work?
- Is the body streamed with a cap, or buffered fully and then rejected?
- Which hosts does `filter_var` or the allowlist still accept?
- Does a pre-auth middleware run the limit and the size cap before the handler reads the body?
- Is there a test that tries the bypass, not only the happy path?

A security finding is promoted into this skill on the first occurrence. See [review-findings.md](../../review-findings.md).
