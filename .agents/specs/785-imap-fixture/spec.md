Source: #785 (body-hash: c91f3483)
Goal: #382

# IMAP fixture in CI for live mail coverage

Technical translation of Task #785. Gates Mail envelope M1. Reopens parked work from #451.

## Goal

A Dovecot (or equivalent) IMAP server on compose profile `mail` next to Mailhog, with seeded maildirs including a References/In-Reply-To thread. PHPUnit tests that need it skip cleanly when the fixture is absent. At least one live REST list folders+messages test replaces a `503 imap_connect` assertion path.

## Non-goals

- JMAP Mail methods (M1/M2)
- Replacing Mailhog SMTP
- Multi-account IMAP

## Affected packages

- compose.dev.yml, docker/mail, packages/api tests and docs, CI

## Technical constraints

- Skip via `WGW_IMAP_FIXTURE_HOST` (empty = skip); CI sets the env and starts the service
- Seeded mailbox must be deterministic (same UIDs/subjects across boots until UIDVALIDITY is deliberately bumped)
- Maildir bind-mount (or equivalent) so tests can bump UIDVALIDITY for M1 contract tests
- `composer done-gate` green with and without the fixture

## Edge cases

- Local `pnpm test:api-done-gate` without Docker profile `mail` stays green (skips)
- CI job has ext-imap already; fixture is network IMAP, not a PHP mock
