Source: #788 (body-hash: 2daf2983)
Goal: #382

# Mail app on the JMAP envelope

Technical translation of Task #788. Live Mail talks RFC 8621 via `JmapMailClient`; mock Storybook path stays on `createMailAppBootstrap`.

## Goal

`createDefaultMailApiSource` / `packages/apps/src/lib/api/wgw/mail.ts` stop calling `/mail/folders|messages|move|drafts` and `/mail/messages/{id}*`. List/detail/mutate/send go through the envelope. Keep the per-message list UI (`threadId` and `mailboxIds` on rows if cheap; no thread pane).

## Non-goals

- Dexie / offline (#400)
- Conversation-thread UI (#398)
- Deleting `/mail/*` REST routes (#789)
- Multi-account UI (#407)

## Affected packages

- packages/apps

## Technical constraints

- `JmapMailClient` next to `JmapContactsClient`; `MAIL_CAPABILITY` / `SUBMISSION_CAPABILITY`; `createMailJmapClient()` via `/jmap/session` + `wgwFetch`
- Vitest methodCalls match `JmapMailClientContractTest` batches (ResultReferences `#ids`)
- Not configured / no imap: session omits mail URN and/or remaining `GET /mail/status`
- Do not assume a single Identity or a single Inbox token as the message identity
- `pnpm test:apps-done-gate`

## Edge cases

- Draft/send: upload `jb-` + `Email/set` create + `EmailSubmission/set`; From from `Identity/get`
- Identity is a list; always use `identityId`
