# Engineering tasks — Verify iMIP replies with DKIM

**Not** a copy of a GitHub issue `- [ ]` acceptance checklist. This file tracks which chunk implements which technical piece.

Source spec: [spec.md](./spec.md)
Source plan: [plan.md](./plan.md)

Do not record chunk completion here. The GitHub issue and the test or file that proves the claim are the record.

## Chunks

| id | owner / agent | skill | key paths | verify command |
|----|---------------|-------|-----------|----------------|
| `chunk-a-dkim-verifier` | builder | api, security | `packages/api/app/Services/Calendars/Imip/Dkim/*.php`, `packages/api/tests/Unit/Calendars/Imip/Dkim*`, `packages/api/tests/fixtures/Calendars/Dkim/` | `php vendor/bin/phpunit tests/Unit/Calendars/Imip` |
| `chunk-b-poller-dkim` | builder | api, security | `packages/api/app/Services/Calendars/Imip/ImipSenderVerifier.php`, `ImipMailboxPoller.php`, `ImipReplyIngest.php`, `ImapClient.php`, `ImipMailboxPayload.php`, `openapi/schemas/calendars/reply-mailbox.json`, `packages/openapi-types/generated/`, `packages/apps/src/lib/api/mock/calendar-reply-mailbox.ts`, `tests/Feature/Calendars/ImipMailboxDkimTest.php` | `pnpm test:api-done-gate` |

## Notes

- Chunk `id` values match `plan.md`.
- Both chunks ship as one API PR. It is security-sensitive: Wouter reviews and merges it.
- On scope change: update the Epic first, then re-sync spec, plan and tasks and the `Source:` body-hash.
