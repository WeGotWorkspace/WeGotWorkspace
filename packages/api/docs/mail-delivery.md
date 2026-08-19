# Platform email delivery

Instance outbound mail for recovery, invites, and other product sends. This is **not** the Mail app (user IMAP/SMTP). Product consumers call `App\Services\MailDelivery\MailDeliveryService::send()` — the Admin test-send button uses that same method.

Authoritative HTTP contract: `openapi/openapi.json` (`GET /admin/state` `mailDelivery`, `PUT /admin/settings`, `POST /admin/mail-delivery/test`).

## Settings

Stored as `mail_delivery_*` (separate from Mail-app `mail_smtp_*` / IMAP). SMTP password is AES-256-GCM; GET returns `smtpPasswordSet` only. Omitted or empty PUT password leaves the stored secret; `clearSmtpPassword: true` clears it.

Default Laravel mailer in `config/mail.php` stays `log`. Runtime mailer name is `wgw`, built from these settings.

## Transports

| Transport | When it is used | Notes |
|-----------|-----------------|--------|
| `auto` (default) | SMTP if smtp-eligible; otherwise PHP `mail()` if available; otherwise sendmail | No silent fallback in the same `send()` after SMTP is chosen and fails |
| `smtp` | Forced SMTP | Host + (username **or** `MailSmtpTransportConfig::normalize()` `smtpAuth=false`) |
| `php` | PHP `mail()` | No extra socket timeout. Shared hosts often accept then drop or spam-folder at Gmail/Outlook |
| `sendmail` | Local sendmail binary | 10s timeout |

**smtp-eligible:** host set AND (username set OR `smtpAuth=false`). Local Postfix (`localhost` / `none`) is eligible without a username. Prefilling `mail_smtp_host` without delivery credentials must **not** make auto select SMTP when auth is required.

SMTP and sendmail use a **10s** timeout (`DeliveryResult` `timeout`). Forced `transport=smtp` without credentials while `smtpAuth` is true returns `smtp_auth_required` (not a 500).

## Capability vs last test-send

| Signal | Meaning |
|--------|---------|
| `capability.canSubmit` | Function check: valid From + a selectable transport. **Not** deliverability |
| `lastTestSend` | Result of the last Admin test send (or `null`). Success is `accepted_by_transport` |
| (none) | There is **no** `available` field and no inbox-placement claim |

Admin UI: **Email delivery** pane (not the Mail IMAP/SMTP pane). Copy splits capability vs last test-send.

## Shared-hosting matrix

| Hosting | Typical choice | Risk |
|---------|----------------|------|
| VPS / dedicated with Postfix or OpenSMTPD on localhost | `auto` or `smtp` (`localhost`, security `none`) | Must still publish SPF/DKIM for the From domain |
| Shared PHP host with `mail()` | `php` or `auto` | Message may be accepted locally and still never reach Gmail/Outlook |
| Shared host with SMTP relay (mailbox or transactional) | `smtp` with host + username (or unauthenticated relay if `smtpAuth=false`) | Prefer the provider’s authenticated submission port (587/465) |
| No local MTA and no relay | Cannot submit | `canSubmit` is false until From + a transport exist |

## SPF / DKIM warning

**Test-send accepted ≠ inbox.** `accepted_by_transport` only means the chosen MTA or relay took the message. PHP `mail()` and sendmail on shared hosting are especially likely to be accepted and then dropped or filed as spam if the From domain has no SPF/DKIM (and usually DMARC) aligned with that host’s outbound IPs.

Configure DNS at the domain registrar / DNS host for the From address you set in Admin. This service does not sign DKIM in-app.

## Tests

Use `Mail::fake()` and the resolver unit matrix. Do not assert live SMTP or inbox placement in CI.

```bash
cd packages/api && php vendor/bin/phpunit --filter MailDelivery
```
