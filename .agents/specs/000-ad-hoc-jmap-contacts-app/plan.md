# Contacts app → JMAP

Derived from [spec.md](./spec.md). Single apps-only chunk (parallel siblings own other packages).

## Goal

Cut the contacts app over to the JMAP envelope except `POST /contacts/cards/import`.

## Non-goals

- API route deletion, OpenAPI edits, PHP

## Affected packages

- packages/apps

## Dependencies

None (develops in parallel with calendar REST deletion, contacts REST deletion, FileNode app, files REST deletion).

## Chunks

### Chunk B: Contacts app → JMAP

- **id:** `jmap-contacts-app`
- **Skill:** workspace, apps-ui
- **Inputs:** `calendar.ts` / `JmapCalendarsClient`; `contacts.ts`, `contacts-set.ts`, `contacts-sync.ts`, `contacts-outbox-flush.ts`, `use-contact-photo-src.ts`; `JmapContactsClientContractTest`
- **Done when:** no `wgwFetch("/contacts/…")` except `/contacts/cards/import`; import Vitest green; `pnpm test:apps-done-gate`
- **Verify with:** `pnpm test:apps-done-gate`
- **Parallel with:** `jmap-calendar-rest-gone`, `jmap-contacts-rest-gone`, `jmap-filenode-app`, `jmap-files-rest-gone`

## Test plan

- [x] Unit: `JmapContactsClient` methodCalls match the contract batches
- [x] Import Vitest (`use-contacts-controller` batch, `contacts-vcard-import.test`) stays green
- [ ] `pnpm test:apps-done-gate`
