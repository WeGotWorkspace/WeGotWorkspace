Source: #1905 (body-hash: c903d136)
Goal: WeGotWorkspace/Product#130

# Download several selected Drive and Docs items as one zip

Technical translation of Task #1905. The issue is the source of truth for every acceptance criterion; this file records how the server and the client meet it and settles the points the issue leaves open. It builds on the folder zip of #1621 ([spec](../1621-drive-folder-zip/spec.md)): same ticket table, same route, same walker and stored-only zip writer.

## Goal

With two or more items selected, the floating selection bar in Drive and in Docs home shows *Download*. The client asks for one ticket for the selected node ids and hands its URL to the browser, which saves `<name>.zip` natively. The server writes one top folder holding the selected files and folders, each folder with its subtree.

## Non-goals

Copied from #1905:
- separate downloads per item
- compression or other formats
- resuming
- guests
- a size limit or progress UI

## Affected packages

- `packages/api`:
  - migration (one column)
  - model
  - `FolderDownloadTicketService`, `FolderZipWalker`, `FolderZipStreamer`
  - controller
  - OpenAPI
  - feature tests
- `packages/apps`:
  - ticket client
  - `downloadSelection` on the Drive operations (live and hybrid)
  - `useDriveSelectionBar`
  - Drive and Docs call sites
  - Vitest
  - live e2e

## Settled decisions

### One route, one table

`POST /jmap/folder-download-tickets/{accountId}` takes either `{nodeId}` (#1621, unchanged) or `{nodeIds, name?}`. Sending both, neither, an empty list, more than 1,000 ids, or an id that is not a FileNode id is a 400. Duplicate ids count once.

`drive_folder_download_tickets` gets a nullable `node_ids` text column (a JSON list). A selection ticket stores the list there and its first id in `node_id`, which stays required. A ticket with `node_ids` null is a folder ticket, as before. One table keeps one secret space, one prune, and one redeem path.

### Rights per node, twice

**When the ticket is issued**, every id must pass four checks:
- it is a live node (file or folder)
- it is on regular Drive storage (`StorageKeyClass::Regular`: not trash, Notes, or attachments)
- its name does not start with `.`
- the account may read it (`FolderZipReadCheck`, the rule the folder zip uses)

If any id fails, the request is a 404 `Item not found.` and no ticket is stored. Answering 404 for the whole request does not tell the caller which id exists.

**When the ticket is redeemed**, the session, account, and expiry checks are unchanged. Then each id is checked again with the same rule. Ids that fail are left out, the same way the walker leaves out a subfolder that became unreadable. When none is left, the URL answers 404.

There is no same-parent rule. The selection bar can span folders in *Recent*, *Starred*, or search results, and rights are checked per node anyway.

### Zip layout and name

- **Name.** The download is `<name>.zip`, and the zip has one top folder `<name>/`.
  - The name comes from the request's `name`: the place the user is looking at, such as the current folder, *Personal*, or *Recent*.
  - It goes through `FolderZipWalker::safeName` and is cut to 120 characters.
  - Without a name, it is `Download`.
- **Order and collisions.** The selected items go straight into the top folder, in request order. Names that collide case-insensitively get ` (2)`, ` (3)`, … (`FolderZipWalker::uniqueName`, as inside a folder).
- **Selected folders** keep their subtree, with the #1621 walker rules:
  - hidden names and unreadable subfolders are left out
  - empty folders are kept
  - each directory is reconciled first
- **Nested selection.** A selected item whose storage key lies inside another selected folder is skipped, so its bytes are stored once.
- **Top folder time.** The top folder's time is the time of the download.

### Client

- **Ticket client.**
  - `issueSelectionDownloadTicket(session, nodeIds, name)` posts the list.
  - `downloadSelectionAsZipWithTicket(session, paths, name, username)` resolves each path's node id, then calls `startNativeDownload(url, name)`.
- **Operations.** `DriveAPIOperations.downloadSelection?(paths, name)` exists on the signed-in live and hybrid operations.
  - Offline, the hybrid one throws "Downloading a folder as a zip needs a connection.", the same message as the folder download.
  - Guests have none.
- **Selection bar.** `useDriveSelectionBar` takes `zipName`.
  - With one item selected, it behaves as today.
  - With two or more, it shows *Download* (`labels.selectionDownload`) when all of these hold: the view is not trash, `downloadSelection` exists, and every selected item has an `apiPath`.
  - The button calls `downloadSelection` and shows "Download started" once the browser has the zip. A failure shows its message.
- **Zip name source.** Drive passes the view's breadcrumb label (`viewLabel`). Docs home passes its header title.

## Verify

- **Feature tests** in `tests/Feature/Jmap/JmapSelectionDownloadTicketTest.php`:
  - a mixed selection of a file and a folder with a nested and an empty subfolder
  - a nested selection stored once
  - name collisions
  - a hidden, a trashed, and an unreadable id refused
  - a share withdrawn after issue: left out, or 404 when nothing is left
  - the 400 rules
  - the name fallback
- **Ownership matrix:** the route is already covered by `DriveOwnershipTest`. Rights per node are covered by the feature tests.
- **Vitest:**
  - the selection bar shows *Download* for two items and calls `downloadSelection` with their paths and the zip name
  - there is no button in trash, without `downloadSelection`, or for guests
  - the hybrid operations refuse offline
- **Live e2e** `drive-selection-download.spec.ts`: select a file and a folder, click *Download*, read the zip entries.
