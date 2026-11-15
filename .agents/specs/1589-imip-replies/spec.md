Source: #1589 (body-hash: 5d41fed0)
Goal: WeGotWorkspace/Product#30

# Apply email replies from external calendar apps to the organizer's event

Technical translation of Epic #1589. Paths are relative to `packages/api/` unless they start with `packages/apps/`.

## Goal

An organizer connects one IMAP mailbox (the one their own invitation address delivers to) in Calendar settings. The scheduler reads new messages from it, picks out `text/calendar` parts with `METHOD:REPLY`, and applies each reply that passes the checks below to the organizer's event through Sabre's iTIP broker. The attendee's participation status changes on the event (one instance for a reply with `RECURRENCE-ID`), and the organizer gets the same `calendar.rsvp` notification a local attendee's reply gives.

## Non-goals

- A mail client. Nothing lists, shows, sends, moves, flags or deletes mail. The mailbox is opened read-only.
- OAuth for Google Workspace or Microsoft 365. Username and password (or an app password) only.
- Inbound `REQUEST`, `CANCEL`, `COUNTER`, `REFRESH`, `ADD`, `DECLINECOUNTER` and `PUBLISH`. They are skipped with a log line. A WGW user invited by an outside organizer keeps using their own mail app for that invitation.
- Delegation (`PARTSTAT=DELEGATED`, `DELEGATED-TO`).
- A shared instance-wide mailbox. Each organizer connects their own.
- Polling on Calendar open. The scheduler is the only trigger.
- iSchedule.

## Affected packages

- `packages/api`: storage, IMAP fetcher, reply ingest, scheduler command, REST settings endpoints, OpenAPI.
- `packages/apps`: one section in the Calendar settings pane (separate PR, visible UI).
- `docs`: `packages/api/docs/mail/README.md` (inbound iMIP no longer "not implemented").

## Technical constraints

### Transport

- Shared hosting: no daemon, no `ext-imap` (gone from PHP 8.4 core and from our Docker images and CI since #1573). The fetcher is a small IMAP4rev1 client on `stream_socket_client` in PHP: `CAPABILITY`, `STARTTLS`, `LOGIN`, `EXAMINE`, `UID SEARCH`, `UID FETCH`, `LOGOUT`. No new Composer dependency.
- Security modes: `ssl` (implicit TLS, default port 993) and `starttls` (default port 143). Certificates are verified. There is no plaintext mode.
- The host resolves to public addresses only (same `PublicIp` rule as calendar feeds); the socket connects to the checked address and verifies the certificate against the host name. An install-level flag (`WGW_IMIP_ALLOW_PRIVATE_HOSTS`, default off) allows private addresses for self-hosters whose mail server is on the same network, and for local e2e. The flag also allows a certificate the host's CA store does not trust.
- Connect and read timeouts are short (10 s connect, 20 s per command); a mailbox that times out is skipped until its next turn.

### Polling and the cursor

- `wgw:calendar:imip-poll` runs every minute from `schedule:run` with `withoutOverlapping()`.
- One run polls enabled mailboxes in order of `last_polled_at` (oldest first), each at most once every 2 minutes, and stops starting new mailboxes after a 40-second budget. The next run continues where it stopped.
- The cursor per mailbox is `(uidvalidity, last_uid)`. A new `UIDVALIDITY` resets the cursor to the mailbox's current highest UID, so old mail is never replayed. On first connect the cursor starts at the current highest UID: only mail that arrives after the mailbox is connected is read.
- One poll reads at most 50 new UIDs; the rest waits for the next turn. The cursor moves past every UID that was looked at, whether it was applied, skipped or failed to parse, so one bad message never blocks the box.
- The mailbox is opened with `EXAMINE` and every fetch uses `BODY.PEEK`, so no message is marked read or changed.

### Parsing

- Per UID, one `UID FETCH` of `RFC822.SIZE`, `BODYSTRUCTURE` and the header fields `FROM`, `SENDER`, `MESSAGE-ID`, `AUTHENTICATION-RESULTS`. Messages over 1 MiB are skipped before any body is read.
- `BODYSTRUCTURE` locates the first `text/calendar` part (or `application/ics` with a `method` parameter). Only that part is fetched (`BODY.PEEK[<section>]`), decoded (`base64`, `quoted-printable`, charset to UTF-8) and parsed with `VObjectPayloadGuard::readICalendar()` (512 KiB, 64 components).
- Headers are unfolded; RFC 2047 encoded words are decoded for display names only.

### Which replies are applied

A reply is applied only when every check passes, in this order (cheapest first). Otherwise it is skipped and logged with identifiers only (mailbox owner, UID, IMAP UID, reason code), never message content.

1. The message is from a single, authenticated sender: the `Authentication-Results` header that the mailbox's receiving server added (the first one, matched on the mailbox's trusted server id) shows that the `From:` domain passed DMARC, or that an aligned SPF or DKIM check passed. Copies of the header further down are ignored.
2. The calendar part has `METHOD:REPLY`, one `UID`, only `VEVENT` components, exactly one `ATTENDEE` per component, and that `ATTENDEE` is the authenticated sender's address.
3. The `ORGANIZER` names the mailbox owner, and the owner organizes an event with that `UID` (`CalendarSchedulingObjects::organizerEvent`).
4. The sender is already an attendee on that event, on every instance the reply names (on the master for an instance that is not an exception yet).
5. `SEQUENCE` is not lower than the event's current `SEQUENCE` for that instance.
6. `PARTSTAT` is `ACCEPTED`, `DECLINED` or `TENTATIVE`.
7. Rate limits: 30 applied replies per mailbox per hour and 10 per sender per mailbox per hour, counted in the shared cache.

Applying uses `Broker::processMessage()` with `sender` set to the attendee value stored on the event, so only that attendee's `PARTSTAT`, `SCHEDULE-STATUS` and `RSVP` change. A reply that changes nothing (the same status again, a duplicate delivery) writes nothing and does not notify.

### What the organizer sees

- The event's attendee status updates on the next calendar sync, like a reply through the RSVP link.
- A `calendar.rsvp` notification through `EventDispatch` with the attendee's `CN` (or email) as the actor label, so bell, toast and push follow the existing rules.
- In Calendar settings: connected or not, last successful check, and the last error as a code (`auth_failed`, `connect_failed`, `tls_failed`, `folder_missing`, `host_not_allowed`, `untrusted_server_unknown`).

### Settings and storage

- New table `calendar_reply_mailboxes` (one row per user): host, port, security, username, encrypted password, folder (default `INBOX`), trusted server id, enabled, cursor, last poll, last success, last error code and time.
- The password is encrypted at rest with the data-dir secret like the SMTP delivery password (AES-256-GCM, its own key label), never returned by the API and never logged.
- REST: `GET`, `PUT` and `DELETE /api/v1/calendars/reply-mailbox`, and `POST /api/v1/calendars/reply-mailbox/test`. `PUT` keeps the stored password when none is sent. `test` logs in, checks the folder, and reads the receiving server id from the newest messages; when they agree, it is stored as the trusted server id. Until a trusted server id is set, no reply is applied.
- The old mail client's leftovers go: the `MailUserCredential` model, the `mail_user_credentials` table, and the stored `mail_imap_*` settings. The installer payload still accepts the `mail_imap_*` fields and ignores them, so the installer UI does not change.
- Saving or testing logs in to the mailbox; 10 logins per user per 10 minutes, then 429.

## Edge cases

- Duplicate delivery of the same reply (same or new IMAP UID): no second write, no second notification.
- A reply to one instance of a series updates only that instance; Sabre adds an exception when the instance had none.
- A reply for an event the organizer has since deleted: skipped (`event_not_found`).
- A reply that arrives after the organizer moved the event (lower `SEQUENCE`): skipped (`stale_sequence`).
- The organizer changes host or username: the cursor and trusted server id reset.
- Wrong password: the error is stored, the box keeps its turn every 2 minutes; after 10 consecutive auth failures polling pauses until the settings are saved again, so the provider does not lock the account.
- Gmail, Outlook.com and Apple iCloud reply formats (`text/calendar` inside `multipart/alternative` or `multipart/mixed`, base64 or quoted-printable).
- Header case and folding; a missing `Authentication-Results` header.
- A receiving server that writes `Authentication-Results` without a server id (Microsoft 365, Outlook.com) cannot be matched, so no reply from such a mailbox is applied. Those mailboxes need OAuth, which is out of scope anyway.
