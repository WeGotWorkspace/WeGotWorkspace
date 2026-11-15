# Engineering tasks — Apply email replies from external calendar apps

**Not** a copy of a GitHub issue `- [ ]` acceptance checklist. This file tracks which chunk implements which technical piece.

Source spec: [spec.md](./spec.md)
Source plan: [plan.md](./plan.md)

Do not record chunk completion here. The GitHub issue and the test or file that proves the claim are the record.

## Chunks

| id | owner / agent | skill | key paths | verify command |
|----|---------------|-------|-----------|----------------|
| `chunk-a-storage` | builder | api, security | `packages/api/database/migrations/wgw/*calendar_reply_mailboxes*`, `app/Models/CalendarReplyMailbox.php`, `app/Support/DataDirSecretBox.php`, `app/Services/MailDelivery/MailDeliverySecretService.php`, `app/Services/Settings/SettingKeys.php` | `pnpm test:api-done-gate` |
| `chunk-b-imap-fetcher` | builder | api, security | `packages/api/app/Services/Calendars/Imip/Imap*.php` | `php vendor/bin/phpunit tests/Unit/Calendars/Imip` |
| `chunk-c-reply-ingest` | builder | api, security | `packages/api/app/Services/Calendars/Imip/ImipSenderAuthentication.php`, `ImipReplyIngest.php`, `ImipReplyRateLimiter.php` | `php vendor/bin/phpunit tests/Feature/Calendars/ImipReplyIngestTest.php` |
| `chunk-d-poll-and-api` | builder | api | `packages/api/app/Services/Calendars/Imip/ImipMailboxPoller.php`, `routes/console.php`, `bootstrap/app.php`, `app/Http/Controllers/Api/V1/Calendars/CalendarReplyMailboxController.php`, `routes/api.php`, `openapi/` | `pnpm test:api-done-gate` |
| `chunk-e-settings-ui` | builder | apps-ui, workspace | `packages/apps/src/settings-core/src/settings-calendar-*`, `packages/apps/src/lib/api/wgw/calendar-reply-mailbox.ts` | `pnpm test:apps-done-gate` |
| `chunk-v-e2e` | verifier | testing | GreenMail container, reply samples, browser | e2e script in the PR |

## Notes

- Chunk `id` values match `plan.md`.
- A–D ship as one API PR; E is its own PR and waits for the product owner's review.
- On scope change: update the Epic first, then re-sync spec, plan and tasks and the `Source:` body-hash.
