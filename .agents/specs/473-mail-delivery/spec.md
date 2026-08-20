Source: #473 (body-hash: f8423ce9)
Goal: #471

# Platform email delivery

Technical translation of Task #473. Product context: Goal #471 (receive email from my instance). Not a copy of the issue AC checklist.

## Goal

Give the instance one internal outbound-mail path (`App\Services\MailDelivery`) and an Admin surface to configure it, without requiring the Mail app. Laravel Mail (runtime mailer `wgw` from DB settings) submits via `auto` / smtp / php / sendmail. Capability (`canSubmit`) is a function check; test-send accepted means the MTA/relay took the message; inbox placement is not an API claim.

## Non-goals

- Password recovery (#389 / #309), magic links, iMIP, Drive invites — they consume this service later
- Mail-app send/receive or requiring `mail_smtp_*` / user mailbox credentials
- Importing `MailOperationService` or PHPMailer for system mail
- Installer wizard step
- Queue/async, in-app DKIM, marketing/bulk, public send route
- Inbox placement at Gmail/Outlook as a success signal

## Affected packages

- `packages/api` — `MailDelivery` domain, `SettingKeys`, OpenAPI admin state/settings/test-send, docs
- `packages/apps` — Admin Email delivery pane + Storybook (not `AdminMailPane`)
- `docs/product/` — roadmap entry for Goal #471

## Technical constraints

- Namespace `App\Services\MailDelivery`. Default `config/mail.php` stays `log`. Build mailer `wgw` at runtime from `mail_delivery_*` settings; reuse `MailSmtpTransportConfig::normalize()` for 465/587/25 quirks.
- Settings are `mail_delivery_*`, not `mail_smtp_*`. SMTP password AES-256-GCM (same family as `MailCredentialService`). GET never echoes the secret; `smtpPasswordSet: bool` only.
- PUT password: omitted or `""` leaves the stored secret; new non-empty value replaces it; `clearSmtpPassword: true` clears it. New password + clear in the same PUT → 400.
- Transport `auto` (default) | `smtp` | `php` | `sendmail`. Auto picks SMTP only when smtp-eligible: host set AND (username set OR normalize() `smtpAuth=false`). No silent fallback to php/sendmail in the same `send()` after SMTP is chosen and fails.
- Forced `transport=smtp` without credentials while `smtpAuth` is true → `DeliveryResult` `smtp_auth_required`.
- SMTP and sendmail: 10s timeout → `DeliveryResult` `timeout`. PHP `mail()` has no extra socket timeout.
- `send()`: invalid message (no/invalid From, no recipients) → exception. Unavailable / connect / auth / timeout → `DeliveryResult` (never an unexpected 500). Success = `accepted_by_transport`.
- `POST /admin/mail-delivery/test` calls the same `MailDeliveryService::send()`. Admin-only, rate-limited. No public send route.
- `GET /admin/state` `mailDelivery`: config, `capability` (`canSubmit`, selected transport, probe flags), `lastTestSend`. No inbox-implying `available` field.
- Admin UI: new pane, distinct from IMAP/SMTP Mail-server pane. Copy splits capability vs last test-send.
- Tests: `Mail::fake()` + resolver unit matrix. No live SMTP/inbox assert in CI.

## Edge cases

- Prefill from `mail_smtp_host` without delivery creds and with auth required → auto must not select SMTP
- Local Postfix (`localhost` / `none`) → host-only is smtp-eligible
- Admin changes only From with an empty password field → stored SMTP secret must survive
- Admin switches to an unauthenticated relay → must use `clearSmtpPassword`
- Forgotten `canSubmit()` in a later consumer → `send()` still returns `DeliveryResult`, not 500
- `php`/`sendmail` locally accepted, then dropped/spammed by Gmail — status must not say “available” as if inbox arrived
