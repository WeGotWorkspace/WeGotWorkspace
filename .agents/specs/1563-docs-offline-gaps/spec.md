Source: #1563 (body-hash: 2d5f7f16)

# Docs offline gaps

Step 2 of #1563. It covers the five known gaps that step 1 (`.agents/specs/1563-docs-inbound-sync/`) left out:

1. An offline create whose name was taken on the server meanwhile.
2. A rename or move while another tab, or another device, has the Doc open offline.
3. Starred and Trash offline.
4. The "Changes synced" toast showing before anything reached the server.
5. The uncaught "Failed to fetch" offline.

The Docs sync matrix is not part of this step.

## Goal

A person who works on Docs offline never loses text, never overwrites someone else's file, and never sees a message that is not true. Every gap was reproduced first in a headless browser against a local install. The live spec `packages/apps/e2e/docs-offline-gaps.spec.ts` keeps each one fixed.

## What was found

| Gap | Reproduced | What happened |
| --- | --- | --- |
| 1. Offline create, name taken | Yes | The flush uploaded over the server file. The other person's text was gone. |
| 2. Rename in another tab, both offline | Yes | The editor stayed on the old path. After reconnect it saved its text to a new file at the old name. |
| 2. Rename on another device, this one offline | Yes | The same, and, once the editor followed, the offline text stayed in the database of the old path. It never reached the file. |
| 3. Starred offline | Yes | Star and unstar were queued, but the Starred list called the server. It failed with a fetch error. |
| 3. Trash offline | Yes | Trash was queued, but the Trash list called the server and failed. Restore (Move out of Trash) had nothing to act on. "Delete permanently" hid the row, then brought it back. The code path shows the trash error "Could not move this file to Trash." (read from the code, not seen live). |
| 4. Early "Changes synced" | Yes | On a flapping network the toast showed while the tab was offline again. On Docs home it showed after every reconnect, also when nothing was queued. |
| 5. Uncaught "Failed to fetch" | Not as an uncaught error | No `pageerror` in any offline sweep (home views, dialogs, editor, reloads on the production build). The visible "Failed to fetch" was the raw list error of Starred, Trash and Shared with me. |

## Decisions

The owner was asleep; each open point is decided here.

1. **Offline create keeps both.**
   - The flush creates the Doc with FileNode/set `create`, which refuses a taken name (`alreadyExists`). It never uploads over a file. On a clash it retries under Drive's keep-both name (`name (1).md`, then `(2)`, …, the same `keepBothName` rule as Drive uploads), up to five times.
   - The Doc then moves on this device to the name it got: listing rows, the pin and Drive sidecars, and the local text. Every tab hears the move. Later queued writes on the old path (rename, star, trash) are re-aimed at the new name before they run.
   - A retried create may have landed with its answer lost. On a retry, a non-empty file under the wanted name with exactly the same size counts as our own earlier create, not as a clash. An empty file never matches, so the name keeps both.
   - While a queued create owns the path, the editor holds its server save, so the open room cannot write to the name before the flush settles it.
2. **The text follows the file.**
   - A cross-tab topic (`docs-path-moves.ts`) tells every tab, this one included, that a path (a file or a folder) is now another path. An open editor of that path, or of a Doc under that folder, opens the new path in place (history replace).
   - The topic is published after an offline rename (queued), an online rename, a kept-both create, and a move that Drive's FileNode inbound reports. It is not published for a path a queued local write still owns: the local name wins until that write settles (step 1, decision 5).
   - Before the topic is published, text in a path-keyed collab database (a Doc opened before its FileNode id was known, or created offline) moves to the new path. Only databases that exist are opened. A database keyed by FileNode id needs nothing, because the id survives a rename.
   - After being offline, the editor holds its server save until the first FileNode pull after reconnect settles. When a move of the open Doc is published, the hold also lasts until the editor is on the new path, online or after that pull. So nothing is written to the old name.
3. **Starred and Trash work offline; what cannot, says so.**
   - Starred offline: the starred paths cached on the device, each given an entry from the Drive cache, else from a cached Docs listing row, else a bare entry. Star and unstar stay queued as before.
   - Trash offline: the Drive cache of the Trash folder, plus the last live listing this tab saw (kept in memory, like step 1 kept Shared and Trash), minus what a queued move took out, plus what a queued trash or move put in. Restore is "Move" out of Trash and is queued like any move.
   - "Delete permanently" is never queued offline. It shows "Deleting permanently needs a connection." and the row stays.
   - Shared with me is read from the server only. Offline it shows "Shared documents are not available offline."
4. **"Changes synced" only once changes reached the server.**
   - Docs home: only when the flush landed something (`flushed > 0`, nothing failed) and the tab is online when the cycle ends.
   - Editor: only when the pending save of the same document cleared while the tab is online. When the editor follows a moved Doc, its pending flag starts over without a toast.
5. **"Failed to fetch".** No uncaught error was found, so there is no handler to add. The visible fetch errors were the list errors of decision 3, which now read from the device or say plainly that a connection is needed. The live spec checks every home view, the Move, Share and New document dialogs and the editor offline for both a visible "Failed to fetch" and an uncaught error.

## Non-goals

- The Docs sync matrix of #1563.
- Shared with me offline (decision 3 keeps it server-only).
- A Trash list that survives an offline reload with Docs trashed online in that session. Drive's FileNode sync drops a Doc that moved into Trash from its cache, so after a reload the offline Trash shows the Drive cache and queued writes only.

## Edge cases

- **Lost create answer.** Decision 1 takes a same-named file of the same size as our own create on a retry, but never for an empty file: every new Doc is uploaded empty, so an empty create always keeps both (the worst case is an empty orphan). A different non-empty file of exactly the same size, created in the same window, would be taken for ours, and the editor then saves into it.
- **`cannotCalculateChanges`.** Drive falls back to a full resync, which reports no moves. An editor of a Doc renamed elsewhere then does not follow; its next save goes to the old path, as before this step.
- **Opening a Doc online while it is being renamed elsewhere.** The hold of decision 2 covers the time after being offline only. A rename in the seconds between opening a Doc online and its first save is not caught.
- **Two tabs migrating the same text.** Both tabs run the inbound. The second finds the old database empty and moves nothing.
- **Starred view freshness.** Star and trash run once their Undo toast closes. A Starred list opened before that shows the state from before the star. This is unchanged from before this step.

## Visible changes

- Starred and Trash show their Docs offline instead of a fetch error.
- Shared with me offline shows "Shared documents are not available offline."
- "Delete permanently" offline shows "Deleting permanently needs a connection."
- An open Doc follows a rename or move made elsewhere (its URL changes to the new name).
- An offline create whose name was taken lands as "name (1).md".
- No "Changes synced" toast on Docs home when nothing was queued, and none while offline.

## Tests

- Live: `packages/apps/e2e/docs-offline-gaps.spec.ts`, one case per gap (gap 2 has two: another tab, another device). Registered in `packages/apps/e2e/live-tier.mjs`.
- Unit:
  - `src/lib/offline/docs/docs-offline-gaps.test.ts`: path moves, text migration, re-aimed queued writes, offline Trash and Starred entries.
  - `src/lib/api/wgw/drive-create-keep-both.test.ts`: keep-both create, lost answer.
  - `src/lib/offline/docs/docs-outbox-flush.test.ts`: kept-both create in the flush.
  - `src/lib/offline/docs/docs-hybrid-operations.test.ts`: offline lists, permanent delete, rename publishes the move.
  - `src/lib/offline/docs/docs-inbound-sync.test.ts`: remote moves reach an open editor, queued-owned paths do not.
  - `src/lib/offline/use-offline-sync-toast.test.tsx`, `src/docs-core/src/use-docs-editor-path-follow.test.tsx`, `src/docs-core/src/use-docs-home-actions.test.tsx`, `src/docs-core/src/use-docs-home-shared-list.test.tsx`, `src/lib/offline/drive/use-drive-file-node-inbound.test.tsx`.
