# IMAP fixture (compose profile `mail`)

Local and CI mail tests that need a real mailbox talk to **Dovecot** (IMAP) next to Mailhog (SMTP). Tests skip cleanly when the fixture is not running.

## Start

```bash
docker compose -f compose.dev.yml --profile mail up -d --build
```

- IMAP: `127.0.0.1:1143` (override with `WGW_IMAP_FIXTURE_PORT`)
- SMTP (Mailhog): `127.0.0.1:1025`
- Mailhog UI: `http://127.0.0.1:8025`

Seeded accounts (PLAIN, no TLS):

| Login | Password | Seed |
|-------|----------|------|
| `bob@example.test` | `mail-secret` | INBOX thread (`Message-ID` / `In-Reply-To` / `References`) |
| `alice@example.test` | `mail-secret` | one inbox message |

## PHPUnit

`Tests\Support\ImapFixture` probes `WGW_IMAP_FIXTURE_HOST`:`WGW_IMAP_FIXTURE_PORT` (defaults `127.0.0.1:1143`). Feature tests that require IMAP call `ImapFixture::available()` and `markTestSkipped` when nothing listens.

CI `api-quality` / `api-mysql` start **only** `mailhog` and `dovecot` from this profile (not `web` / `scheduler`). Those Apache services bind-mount `packages/api` and would make `storage/` unwritable for host PHPUnit.

Without the fixture, the suite stays green: JMAP mail contract tests that need a live mailbox skip; session/capability, status, Settings, and REST-sunset tests still run. The live list case is `Mailbox/get` + `Email/query` (not `/mail/folders`).
