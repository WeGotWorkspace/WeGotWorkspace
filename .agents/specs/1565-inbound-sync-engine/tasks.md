# Engineering tasks — One inbound sync engine for the offline collections

**Not** a copy of the GitHub issue checklist.

Source spec: [spec.md](./spec.md)  
Source plan: [plan.md](./plan.md)

Do not record chunk completion here. The GitHub issue and the test or file that proves the claim are the record.

## Chunks

| id | owner / agent | skill | key paths | verify command |
|----|---------------|-------|-----------|----------------|
| `jmap-get-chunks` | builder | workspace | `packages/apps/src/lib/jmap-client/core/`, `packages/apps/src/lib/jmap-client/notes/JmapNotesClient.ts`, `packages/apps/src/lib/jmap-client/calendars/JmapCalendarsClient.ts`, `packages/apps/src/lib/jmap-client/chat/JmapChatClient.ts`, `packages/apps/src/lib/jmap-client/contacts/JmapContactsClient.ts` | `pnpm --dir packages/apps exec vitest run src/lib/jmap-client` |
| `inbound-core` | builder | workspace | `packages/apps/src/lib/offline/core/inbound-sync.ts`, `packages/apps/src/lib/offline/core/inbound-sync.test.ts` | `pnpm --dir packages/apps exec vitest run src/lib/offline/core/inbound-sync.test.ts` |
| `notes-on-core` | builder | workspace | `packages/apps/src/lib/offline/notes-inbound-sync.ts`, `packages/apps/src/lib/offline/notes-jmap-inbound.ts`, `packages/apps/src/lib/offline/notes-offline-store.ts` | `pnpm --dir packages/apps exec vitest run src/lib/offline src/notes-core` + `pnpm --dir packages/apps exec playwright test -c playwright.matrix.config.mjs notes-sync-matrix` |
| `tasks-on-core` | builder | workspace | `packages/apps/src/lib/offline/tasks-inbound-sync.ts`, `packages/apps/src/lib/offline/tasks-inbound.ts` | `pnpm --dir packages/apps exec vitest run src/lib/offline src/tasks-core` + live `tasks-inbound-sync` spec |
| `adapters-on-core` | builder | workspace | `packages/apps/src/lib/jmap-client/adapter/JmapInboundAdapter.ts` (from #1785) | `pnpm --dir packages/apps exec vitest run src/lib/jmap-client/adapter` |
| `contacts-on-core` | builder | workspace | `packages/apps/src/lib/offline/contacts-jmap-inbound.ts`, `packages/apps/src/lib/api/wgw/contacts-sync.ts` | `pnpm --dir packages/apps exec vitest run src/lib/offline src/lib/api/wgw/contacts-sync.test.ts src/contacts-core` |
| `calendars-on-core` | builder | workspace | `packages/apps/src/lib/offline/calendars-jmap-inbound.ts`, `packages/apps/src/lib/offline/calendars-offline-store.ts` | `pnpm --dir packages/apps exec vitest run src/lib/offline src/calendar-core` |
| `chat-on-core` | builder | workspace | `packages/apps/src/lib/offline/meet-chat-jmap-inbound.ts`, `packages/apps/src/lib/offline/meet-chat-offline-store.ts`, `packages/apps/src/lib/offline/meet-chat-outbox-flush.ts` | `pnpm --dir packages/apps exec vitest run src/lib/offline src/meet-core` |

## Notes

- Chunk ids match `plan.md`.
- On scope change: update issue #1565 first, then re-sync these files and the `Source:` body-hash.
