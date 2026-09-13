Source: #749 (body-hash: 543b5e8d)
Goal: #548

# Persist Docs comment and suggestion threads as VJOURNAL

Technical translation of Task #749 — persist both Docs comment-threads and suggestion-threads in one VJOURNAL model keyed by the Doc virtual path, ACL’d only through DriveShareAuthorizer. Follow-up Task #750 archives suggestion journals on accept/reject.

## Goal

Replace the Yjs `comments` / `suggestionThreads` maps as the source of truth with a chat-style VJOURNAL store: one hidden calendar pool per file-owner principal, REST assembly of the current review-panel types, and producer events `docs.comment_posted` / `docs.suggestion_posted` on new root or reply messages. Suggestion **marks** stay in Yjs.

## Non-goals

- Suggestion mark / track-change XML (Yjs)
- `mayReview` / suggest-vs-edit share split
- Comment/suggestion notify inbox (Goal #548 remaining half)
- Doc @mention (#549), guest comments (#546)
- Migrating existing Yjs threads
- Per-doc CalendarInstance / calendar sharing
- Closing comment-tier Yjs PUT on `/files/collaboration`
- JMAP for threads; presence live-acceleration envelopes
- Task #750 accept/reject → archive coupling (specified here, implemented after storage)

## Affected packages

- packages/api — converter, pool, OpenAPI `/files/threads*`, DAV-hidden prefix, Drive `assertMayComment`, producer emitter
- packages/apps — `docs-collab/` REST cutover; review panel keeps domain types
- .agents/specs/749-docs-threads-vjournal/

## Technical constraints

- Base on `ChatMessageJournalConverter` / `ChatMessageRepository` (RELATED-TO exists only in chat). Mutations go through Sabre so `calendarchanges` works.
- Threads attach to `?path=` (rest-design). Storage pool URI `docs-threads` is a DAV-hidden VJOURNAL collection per file-owner principal — not a product channel. No `shareWith`.
- Lookup via `X-WGW-DOC-PATH` plus `docs_thread_index`. Rename/move retargets; deleting a Doc drops journals.
- ACL: `mayView` list, `mayComment` mutate. Add `assertMayComment` only; do not change `mayReview`.
- Anchors are plain data (`X-WGW-ANCHOR-*`). Reactions: `X-WGW-REACTIONS` JSON on the **root**, transactional rewrite.
- DAV-hidden: extend `wgw.chat.dav_hidden_prefixes` with `docs-threads`. Notes stay DAV-visible.
- Events: local emitter (EventDispatch is not on main). Do not extend the notify allow-list.
- Client: one-shot cutover; no dual-read of Y.Maps. Poll the path-scoped changes feed while the Doc workspace is mounted.
- x-wgw-access: `user`. Guest comments are out of scope.

## Edge cases

- Comment-grant sharee (`mayComment`, not `mayEditContent`) can POST; view-only gets 403.
- Suggestion roots carry `X-WGW-CHANGE-ID`; comments do not.
- `X-WGW-ARCHIVED` is not `STATUS:CANCELLED` (tombstone). Archived suggestion threads are omitted from GET list; resolved comments remain for the Resolved tab.
- ULID client ids: idempotent create like chat.
- Group-owned Docs (`/groups/{slug}/…`) use the group principal’s pool.
- Restart/reload lists threads from VJOURNAL the same way chat messages survive.
