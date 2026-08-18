# Platform email delivery

Derived from [spec.md](./spec.md).

## Goal

Ship platform outbound mail (Goal #471 / Task #473): internal `MailDeliveryService`, Admin Email delivery pane, capability ≠ deliverability, test-send on the same `send()` path.

## Non-goals

- Recovery / magic links / iMIP / Drive invites
- Mail-app SMTP requirement, installer step, queue, in-app DKIM, PHPMailer for system mail

## Affected packages

- packages/api | packages/apps | docs/product | packages/api/docs

## Dependencies

1. Chunk **A** first (OpenAPI + service contract).
2. Chunk **B** after A (Admin UI consumes `mailDelivery` / test-send).
3. Chunk **C** after A (docs can start from the contract; UI copy pointers after B).

## Chunks

### Chunk A: API domain

- **id:** `mail-delivery-api`
- **Skill:** api, testing
- **Inputs:** Task #473 AC; `SettingKeys`; `MailSmtpTransportConfig`; OpenAPI `/admin/state`, `/admin/settings`, `POST /admin/mail-delivery/test`
- **Done when:**
  - resolver/probe unit-tests, including smtp-eligible (host+user, host-only+`smtpAuth=false`, host-only+auth-required → no auto-smtp)
  - `send()` on unavailable/timeout/auth-required → `DeliveryResult`, no 500
  - SMTP and sendmail mailers timeout 10s (pinned)
  - PUT: omitted/`""` password keeps secret; `clearSmtpPassword: true` clears; both + new password → 400; no plaintext password in JSON
  - test-send goes through `MailDeliveryService::send()`
  - `GET /admin/state` splits `capability` and `lastTestSend`
  - runtime mailer `wgw`; `composer done-gate`
- **Verify with:** `pnpm test:api-done-gate` (or `composer done-gate` in `packages/api`)
- **Parallel with:** none

### Chunk B: Admin UI

- **id:** `mail-delivery-admin-ui`
- **Skill:** workspace, apps-ui, storybook
- **Inputs:** A OpenAPI; `admin-mail-pane.tsx` stays Mail-app only; `use-admin-sidebar-model.tsx`
- **Done when:**
  - From + transport + optional SMTP persist; empty password field is not sent / server keeps secret
  - `smtpPasswordSet` shows a clear-password action (`clearSmtpPassword: true`)
  - UI shows capability vs last test-send separately; copy does not claim inbox
  - test-send + timeout/error visible; Mail pane unchanged
  - Storybook mock-tier: capability-ok/test-null, test-accepted, test-failed, cannot-submit
- **Verify with:** targeted Vitest / Storybook; later `pnpm test:apps-done-gate`
- **Parallel with:** none (waits on A)

### Chunk C: docs + consumer pointers

- **id:** `mail-delivery-docs`
- **Skill:** document
- **Inputs:** A contract; Goal #471 / Task #473; already-updated #309 / #389 comments
- **Done when:**
  - `packages/api/docs/mail-delivery.md`: shared-hosting matrix + SPF/DKIM warning (test-send accepted ≠ inbox, especially `php`/`sendmail`)
  - documented that test-send and product send use the same `send()`
  - roadmap already lists Goal #471 (this filing)
- **Verify with:** doc review against Task #473 AC docs bullets
- **Parallel with:** none (after A; can overlap B)

## Test plan

- [x] API: OpenAPI → failing feature tests → implement → `composer done-gate`
- [x] Unit: smtp-eligible matrix; From validation; timeout on mailer config
- [x] Feature: admin save/state/test-send via real `send()`; `Mail::fake()`; password omit vs clear
- [x] UI: Storybook mock-tier for capability vs lastTestSend
- [x] No live SMTP / inbox assert in CI

## Doc updates

- `.agents/specs/473-mail-delivery/` (this folder)
- `docs/product/roadmap.md` + `docs/product/project-setup.md` Adopted snapshot
- `packages/api/docs/mail-delivery.md` in chunk C
