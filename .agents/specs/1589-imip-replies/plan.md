# Apply email replies from external calendar apps

Derived from [spec.md](./spec.md). Line references are to `origin/main` at `d2879da3a` (2026-11-13). API paths are relative to `packages/api/`, app paths to `packages/apps/src/`.

## Goal

An organizer connects the IMAP mailbox their invitation address delivers to. The scheduler reads new `text/calendar` replies from it and applies the ones from authenticated attendees to the organizer's event, through the same Sabre broker and notifier the local scheduling path uses.

## Budget

- **Draws from:** Wave 4 of the Pioneer programme milestone, where #1589 sits.
- **Displaces:** the leftover tables and settings keys of the removed mail client, which this work deletes instead of keeping a second unused credential store.

## Non-goals

See spec.md, Non-goals.

## What exists

**Scheduling**

- Local delivery applies an iTIP message to the recipient's object with `Broker::processMessage()` and then notifies. `path: packages/api/app/Services/Calendars/CalendarSchedulingService.php:373`, `path: packages/api/app/Services/Calendars/CalendarSchedulingService.php:402`
- A REPLY is only applied to an event the recipient organizes and only for an attendee already on it. `path: packages/api/app/Services/Calendars/CalendarSchedulingDeliveryPolicy.php:39`
- The event a user organizes for a UID, across own, Team and write-shared calendars. `path: packages/api/app/Services/Calendars/CalendarSchedulingObjects.php:91`
- Sabre's broker takes the new `PARTSTAT` from the first `ATTENDEE` of each reply component, matches the stored attendee by exact string equality with `Message::sender`, and adds the sender as a new attendee when no match is found. sabre/vobject 4.6.1 (`composer.lock`). [`Broker.php:358`](https://github.com/sabre-io/vobject/blob/4.6.1/lib/ITip/Broker.php#L358), [`Broker.php:379`](https://github.com/sabre-io/vobject/blob/4.6.1/lib/ITip/Broker.php#L379), [`Broker.php:392`](https://github.com/sabre-io/vobject/blob/4.6.1/lib/ITip/Broker.php#L392)
- The RSVP notification copy and dedupe key. `path: packages/api/app/Services/Notify/CalendarRsvpNotify.php:76`. The notifier skips a reply whose actor is the organizer. `path: packages/api/app/Services/Calendars/CalendarSchedulingNotifier.php:82`. The notify listener drops a recipient equal to the actor. `path: packages/api/app/Events/NotifyListener.php:57`
- Outbound iMIP sends from the platform address; the `ORGANIZER` in the invitation is the organizer's own calendar address, so replies go to the organizer's mailbox. `path: packages/api/app/Services/Calendars/CalendarImipService.php:149`, `path: packages/api/app/Services/Calendars/CalendarPrincipalAddresses.php:196`

**Parsing and limits**

- ICS size and component guards. `path: packages/api/app/Services/VObject/VObjectPayloadGuard.php:22`, `path: packages/api/app/Services/VObject/VObjectPayloadGuard.php:31`, `path: packages/api/app/Services/VObject/VObjectPayloadGuard.php:60`
- Shared-cache limiter pattern. `path: packages/api/app/Services/Calendars/CalendarRsvpRateLimiter.php:24`
- Public-address check for caller-chosen hosts. `path: packages/api/app/Services/Calendars/SsrfSafeIcsFetcher.php:223`

**Secrets and leftovers**

- The SMTP delivery password is encrypted with AES-256-GCM under a key derived from the data-dir secret. `path: packages/api/app/Services/MailDelivery/MailDeliverySecretService.php:57`
- `mail_user_credentials` is still created and only read by user deletion. `path: packages/api/database/migrations/wgw/2026_06_06_000020_wgw_create_app_settings_and_mail.php:20`, `path: packages/api/app/Services/Admin/AdminUserProvisionerService.php:182`
- `ext-imap` and the MIME parser left with the mail client.
  > The client's PHP dependencies went with it: `phpmailer/phpmailer`, `zbateson/mail-mime-parser`, and the `ext-imap` extension in the Docker images and CI.
  (`git show cb95b20b0 -- packages/api/docs/mail/README.md`)

**Scheduler**

- `schedule:run` commands with `everyMinute()->withoutOverlapping()`. `path: packages/api/bootstrap/app.php:57`

## Considered

- **`ext-imap`** (`imap_open`): rejected. Removed from PHP 8.4 core, not on many shared hosts, and removed from our images in #1573.
- **`webklex/php-imap`** (pure PHP): rejected. It pulls Carbon, Symfony and a full message model for a job that needs six IMAP commands; the Epic's scope guard asks for one fetcher.
- **Full MIME parsing** (`zbateson/mail-mime-parser`): rejected. `BODYSTRUCTURE` lets the server find the calendar part, so only that part is downloaded and decoded.
- **Poll when Calendar opens** (the Epic's other option): not now. It would run an IMAP login inside a web request; the minute scheduler already gives a 2-minute delay.
- **Reusing `CalendarSchedulingService::deliverLocal`**: rejected for the apply step. It stores the reply in the scheduling inbox and labels the notification with a local username. The new applier uses the same broker and `CalendarRsvpNotify::eventData` instead, and the existing `CalendarSchedulingDeliveryPolicy::allows` for the organizer and attendee check.
- **Reusing `mail_user_credentials`**: rejected. It is keyed for the old instance-wide IMAP server and has no host, folder or cursor. It is dropped instead, as the Epic asks ("do not leave both").
- **One instance mailbox set by an admin**: rejected. Replies are addressed to each organizer's own `ORGANIZER` address.

## Affected packages

- packages/api
- packages/apps (chunk E only)
- docs

## Dependencies

1. Chunk A (storage, secret) before B, C, D.
2. Chunk B (fetcher) and chunk C (reply ingest) in parallel after A.
3. Chunk D (poll command, REST, OpenAPI) after B and C.
4. Chunk E (settings UI) after D's OpenAPI.
5. Chunk V (e2e) after D; E for the browser part.

## Open decisions

None open. Four product choices were chosen overnight on 2026-11-13 by the overview session (A, the safest option), to confirm with Wouter:

1. One reply mailbox per user, not one shared mailbox for the instance.
2. Inbound `REQUEST` and `CANCEL` from outside organizers are skipped and logged, never applied.
3. The mailbox is opened read-only: nothing is marked read, moved or deleted.
4. A reply that is not applied is skipped silently with a log line; Calendar settings show the last check time and the last error.

## Invariants

- A reply without a passing `Authentication-Results` from the trusted receiving server changes nothing. A wrong change applies replies on header claims alone. Proof: `path: packages/api/tests/Feature/Calendars/ImipReplyIngestTest.php` assertion `test_reply_without_trusted_authentication_is_skipped`.
- A reply only ever changes the sending attendee's own attendee line. A wrong change lets one attendee set another's status or add a new attendee. Proof: `path: packages/api/tests/Feature/Calendars/ImipReplyIngestTest.php` assertion `test_reply_naming_another_attendee_is_skipped`.
- Local scheduling (web app and CalDAV) still delivers and notifies as before. A wrong change breaks invites between users. Proof: `cmd: cd packages/api && php vendor/bin/phpunit tests/Feature/Notify/CalendarCalDavNotifyTest.php tests/Feature/Calendars`.
- The SMTP delivery password still decrypts after the secret helper is shared. A wrong change loses the admin's mail settings. Proof: `path: packages/api/tests/Unit/Support/DataDirSecretBoxTest.php` assertion `test_mail_delivery_label_matches_previous_key`.
- After chunk D, nothing polls until a user saves a mailbox. A wrong change opens sockets on every install. Proof: `path: packages/api/tests/Feature/Calendars/ImipMailboxPollTest.php` assertion `test_poll_without_mailboxes_does_nothing`.

## Chunks

### Chunk A: storage and secret

- **Skill:** api, security
- **Inputs:** SMTP secret key label — `path: packages/api/app/Services/MailDelivery/MailDeliverySecretService.php:57`; leftover table — `path: packages/api/database/migrations/wgw/2026_06_06_000020_wgw_create_app_settings_and_mail.php:20`
- **Done when:** `calendar_reply_mailboxes` exists; `DataDirSecretBox` encrypts per label and the SMTP label is unchanged; `MailUserCredential`, `mail_user_credentials` and `mail_imap_*` keys are gone.
- **Verify with:** `pnpm test:api-done-gate`
- **Parallel with:** none

### Chunk B: IMAP fetcher

- **Skill:** api, security
- **Inputs:** public-address rule — `path: packages/api/app/Services/Calendars/SsrfSafeIcsFetcher.php:223`
- **Done when:** a socket IMAP client logs in over TLS or STARTTLS, `EXAMINE`s the folder, lists UIDs after the cursor, fetches size, `BODYSTRUCTURE`, selected headers and one body section; responses with literals parse; tests run against a scripted fake server.
- **Verify with:** `cd packages/api && php vendor/bin/phpunit tests/Unit/Calendars/Imip`
- **Parallel with:** C

### Chunk C: reply ingest

- **Skill:** api, security
- **Inputs:** broker apply — `path: packages/api/app/Services/Calendars/CalendarSchedulingService.php:402`; delivery policy — `path: packages/api/app/Services/Calendars/CalendarSchedulingDeliveryPolicy.php:31`; notify copy — `path: packages/api/app/Services/Notify/CalendarRsvpNotify.php:76`
- **Done when:** sender authentication, the reply checks of spec.md in order, rate limits, apply and notify are in place, with one test per check.
- **Verify with:** `cd packages/api && php vendor/bin/phpunit tests/Feature/Calendars/ImipReplyIngestTest.php`
- **Parallel with:** B

### Chunk D: poll command, REST and OpenAPI

- **Skill:** api
- **Inputs:** scheduler — `path: packages/api/bootstrap/app.php:57`
- **Done when:** `wgw:calendar:imip-poll` runs every minute; the four REST routes exist and match OpenAPI; status and error codes are stored.
- **Verify with:** `pnpm test:api-done-gate`
- **Parallel with:** none

### Chunk E: Calendar settings section (visible UI)

- **Skill:** apps-ui, workspace, client-transport
- **Inputs:** Calendar settings pane — `path: packages/apps/src/settings-core/src/settings-calendar-form-schema.ts:22`
- **Done when:** a "Receive replies to invitations" section with inline `FieldLabelRow` rows (host, port, security, username, password, folder), autosave with Done, a Test connection action, status line, and copy that says the server reads only calendar replies. Waits for the product owner's review.
- **Verify with:** `pnpm test:apps-done-gate`
- **Parallel with:** none

### Chunk V: e2e

- **Skill:** testing
- **Inputs:** chunk D routes and command
- **Done when:** a GreenMail container holds a test mailbox; Apple Calendar, Outlook and Gmail reply samples are delivered to it; the poll applies them; the organizer's event and the bell update in a real browser.
- **Verify with:** the e2e script in the PR description
- **Parallel with:** none

## Test plan

- [ ] Unit: IMAP response parser, `BODYSTRUCTURE` parser, transfer decoding, `Authentication-Results` parser and alignment.
- [ ] Feature: one test per reply check in spec.md, duplicate delivery, `RECURRENCE-ID`, stale `SEQUENCE`, rate limits, notification.
- [ ] Feature: poll command with a fake fetcher (cursor, `UIDVALIDITY` reset, size skip, error codes, auth-failure pause).
- [ ] Feature: REST routes (password never returned, kept on save without a password, test route stores the trusted server id).
- [ ] e2e against GreenMail with real client samples.

## Doc updates (only if user wants)

- `packages/api/docs/mail/README.md`: inbound iMIP replies.
