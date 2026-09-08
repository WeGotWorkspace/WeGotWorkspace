# Engineering tasks — Meet chat backend + live workspace

**Not** a copy of the GitHub issue `- [ ]` acceptance checklist. This file tracks **which agent/chunk implements which technical piece** for multitask and worktree handoffs.

Source spec: [spec.md](./spec.md)
Source plan: [plan.md](./plan.md)

## Chunks

| id | owner / agent | skill | key paths | verify command | status |
| --- | --- | --- | --- | --- | --- |
| `file-issues-spec` | builder (this phase) | developer, plan-feature, git-workflow | `.agents/specs/701-meet-chat-backend/` | `gh issue view 701`; body-hash `d8ff6cc8` | done |
| `chunk-a-openapi` | builder (this phase) | api | `packages/api/openapi/schemas/chat/`, `openapi/openapi.json`, generated types | `pnpm --filter @wgw/api typegen`; `composer test -- --filter OpenApi` | done |
| `chunk-b-channels` | builder (this phase) | api | `ChatChannelRepository`, `chat_channel_meta` migration, channels controller, DAV-exposure filter + regression test | `composer test`; `pnpm test:api-done-gate` | done |
| `chunk-c-messages` | builder (this phase) | api | `ChatMessageJournalConverter`, message repo/controllers, `chat_read_markers` migration | `composer test`; `pnpm test:api-done-gate` | done |
| `chunk-d-jmap` | builder (this phase) | api | `Jmap/Methods/ChatChannel*`, `ChatMessage*`, capability provider, state codec, `tests/Feature/Jmap/` | `composer test -- --filter Jmap` | done |
| `chunk-e-client` | later | apps-ui, workspace | `lib/api/wgw/meet-chat.ts`, `lib/offline/meet-chat-hybrid-operations.ts`, `meet-chat-jmap-inbound`, `meet-chat-api-source.ts`, `use-meet-chat-api.ts` | targeted Vitest; `pnpm --filter @wgw/apps typecheck` | pending |
| `chunk-f-liveapp` | later | workspace, meet | live `MeetApp`, `startCall` RTC wiring, `wegotworkspace-routes.tsx` flip, guest flow, screen-share parity | targeted Vitest + stories; manual :5174 smoke | pending |
| `chunk-g-dms` | builder (this phase) | api, apps-ui | DM auto-provision, unread badges, DM rail wiring | feature tests + targeted Vitest | done |
| `chunk-h-join-policy` | builder (this phase) | api | `MeetChannelJoinPolicy` in `MeetSignalingService`, join matrix feature tests | `composer test` signaling suites | done |
| `chunk-i-knock-ui` | later | meet, apps-ui, storybook | knock/admit in `MeetCallStage`, pending-knock list, stories | stories + Storybook coverage | done |
| `chunk-k-typing` | later | meet, apps-ui | presence-core typing wiring, typing-indicator UI, stories | targeted Vitest + stories | pending |
| `chunk-l-calendar-picker` | later | workspace, apps-ui | calendar event form Meet-channel conferencing picker | targeted Vitest + calendar stories | pending |
| `chunk-j-cleanup` | later | meet, document | delete `MeetCallWorkspace` + lobby/room panes + old chat pane + stories; docs/exports | Storybook coverage + typecheck | done |
| `chunk-m-group-defaults` | builder (this phase) | api | `ChatGroupDefaultChannelProvisioner`, `ChatCollectionUris::groupDefaultUri`, `default_for_group` migration, repository guards, admin create hook | `composer test` chat/JMAP/meet suites; `pnpm test:api-done-gate` | done |
| `chunk-v-verify` | later | testing | done gates, verify-issue #702–#709, cross-chunk verifier | `pnpm test:api-done-gate`; `pnpm test:apps-done-gate` | pending |

## Notes

- Chunk `id` values must match `plan.md` chunk IDs and multitask handoff names.
- Update **status** as chunks complete (`pending` → `done`).
- On scope change: update **Epic #701** (and the affected child Task) first, then re-sync spec/plan/tasks and the `Source:` body-hash in spec.md.
- Chunk→Task map: A/B/C → #702, D → #703, E/F → #704, H/I → #705, G → #706, K → #707, J → #708, L → #709.
- Branch `feat/meet-chat-backend` tracks Epic **#701**, not Goal #686.
- Worktree: `/Users/woutervroege/Sites/sabre-installer-meet-chat-ui` (port offset 1 → dev :5174).
- Chunk A note: `OpenApiRouteContractTest` is strictly bidirectional, so `/chat/*` routes were registered as 501 stubs (`ChatContractStubController`) inside the `wgw.auth`+`wgw.role:user` group; chunks B/C replaced them with real controllers (stub controller deleted in chunk C). `{channelId}` sample added to `OpenApiContract::sampleRequestPath` for the role-matrix smoke.
- Chunk B/C note: chat collections are VJOURNAL calendars with `chat-`/`dm-` URI prefixes, hidden from WebDAV via `ChatHiddenCalendarBackend` (DAV server only; prefixes configurable via `wgw.chat.dav_hidden_prefixes`). Messages: client-ULID idempotent create, author-only edit/delete (SEQUENCE bumps only on body edits), transactional reaction toggles, sync-token changes feeds with honest `hasMoreChanges`, `chat_read_markers` + `unreadCount` on the channel list. `WgwSchemaMigrator::CURRENT_SCHEMA_VERSION` bumped 37 → 39 for the two chat migrations.
- Chunk D note: vendor capability `urn:wgw:jmap:chat` ships **get/changes only** (mutations stay REST; no `/set` methods — deviation recorded in `packages/apps/docs/meet-chat-client.md`). `ChatMessage/changes` fans out per channel via `JmapAccountStateCodec` with honest `hasMoreChanges` paging; vanished channels signal only via `ChatChannel/changes.destroyed` (client prunes messages), newly shared channels are primed at their current token — REST history backfill is mandatory. No `JmapNoteStateService`-style bookkeeping table needed.
- Chunk M note: every ACL group gets one default chat channel. Owned by the **group principal** (like group notebooks — no share invites; membership follows `groupmembers`), deterministic uri `chat-grp-{sha256(slug) 40 hex}` (mirrors `dm-` hashing; fits the 64-char room-id limit), marked in `chat_channel_meta.default_for_group` (unique index; schema version 40 → 41). Provisioned lazily in `ChatChannelRepository::accessibleChatInstances` (covers REST list/changes + all JMAP paths and retro-fits pre-existing groups) and eagerly in `AdminGroupManagementService::create`. Immutable through the generic channel endpoints like DMs (no rename/color/topic/share/transfer/delete — `myRights.mayShare/mayDelete` report false, new optional `isDefault` on the ChatChannel schema); display name tracks the group name (re-synced through the Sabre backend so renames ride the changes feed); channel dies with the group (`deleteDavCollections`). Known edge: a pre-provisioning squat of the deterministic uri via client-supplied channel id is skipped, never hijacked.
- Chunk H note: `MeetChannelJoinPolicy` resolves rooms by `chat-`/`dm-` collection uri or `chat_channel_meta.room_code`. Members (ACL read access) join directly; non-members/guests are forced onto the knock path (`knock_required` 403); guests never join `dm-` rooms. Admission is recorded server-side (`meet_peers.admitted`, schema version 39 → 40) when a channel member sends an `admit` control message; re-knocks clear it. Non-channel rooms keep legacy behavior. `MAX_PEERS_PER_ROOM` (4) unchanged and counts knockers.
