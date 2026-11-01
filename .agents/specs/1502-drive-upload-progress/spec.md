Source: #1502 (body-hash: cb3d6017)
Goal: #1498

# Drive upload progress: ring in the pin slot, placeholder states, Uploads view

First UI slice of Epic #1499, on top of the queue from #1501. Shows each queued file's state where the offline control sits, adds an Uploads view across folders, and moves upload copy into `driveLabels`.

## Goal

A signed-in user who drops files into Drive sees each file's state in the folder (list and grid) and in a new Uploads view, in every open tab. Waiting, waiting offline, waiting for an answer, uploading, finishing on the server, and failed each look and read differently. Failed files say why and offer _Retry_ (when it can work) and _Remove_. The toast says files were added when they are queued, and says "Uploaded" only once they are on the server.

## Non-goals

- The batch stepper dialog (#1521). This slice only shows "Waiting for your answer" for items of a batch in `awaiting_input`.
- Error and pause states beyond what #1501 reports, and retiring the global upload bar (#1522). The direct (mock / no-queue) path keeps the floating bar.
- Per-part progress and the `assembling` phase itself (#1519). This slice reads `bytesDone` and an optional `phase: "assembling"` and shows them when set.
- Guest and Docs uploads.

## Affected packages

- packages/apps

## Decisions

- **Ring primitive.** `ui/progress.tsx` exports `ProgressRing` on `@radix-ui/react-progress` (re-added; it was removed as unused). `role="progressbar"`, `aria-label` "Upload of <name>", and an `aria-valuetext` that always says the state, so an indeterminate ring is never read as 0%. `aria-valuenow` is set only while a percentage is known.
- **Indeterminate until bytes arrive.** `driveUploadPercent` is `null` while `bytesDone` is 0. A whole-file upload reports bytes only at the end, so its ring spins. When #1519 reports parts, the same code shows a percentage.
- **One row state.** `driveUploadRowState(marker, live)` turns the cached placeholder marker plus the live queue item, batch, and queue state into kind, percent, status text, value text, and which actions apply. The ring, the status line, the menu, and the Uploads view all read it.
- **One queue watch per account.** `sharedDriveUploadQueueWatch(username)` shares one `subscribeDriveUploadQueue` per account and replays the latest snapshot to new listeners, so the workspace, the toast tracker, and the Uploads view do not each open IndexedDB reads. The sign-out wipe resets it.
- **Retry.** `retryDriveUploadItem` and `retryAllFailedDriveUploads` put a failed item back to `queued` with bytes, failures, error, and retry time cleared, and the placeholder back to `queued`. `no_local_copy` and `quota` are refused (`canRetry: false`): the bytes are gone, the file has to be added again.
- **Placeholders are inert.** They cannot be selected, long-pressed, or dragged, preview fetches skip them, and open, download, rename, move, and share are in their menu but disabled with "Available after the upload". Opening one shows a toast with the same reason.
- **Sidebar.** `uploads` joins `FILES_BROWSER_SIDEBAR_PRIMARY_ORDER` between Starred and Trash. Drive shows it while the queue has items or the view is open, with a count and an error badge. Docs maps it to `null`.
- **Uploads view.** `view=uploads` route, `CloudUpload` icon, "Uploads" breadcrumb. Rows come from the queue snapshot, with the target folder from the placeholder's cache path (`folderPaths` read in the same transaction). When the queue empties while the view is open, it says "All uploads are done" with a link to the last batch's folder.
- **Toasts.** "Added N files to uploads" when queued; per tab, a tracker toasts "Uploaded N files", a partial result, or a failure once none of the batch's files waits or uploads. Files removed in this tab do not count as uploaded.
- **Screen readers.** A polite live region announces start, each 25% step, done, and failure, not every byte.

## Edge cases

- A file removed in another tab disappears from the batch without a toast count in this tab being reduced (known; counts it as uploaded).
- A placeholder whose folder is not cached here has no target folder line in the Uploads view.
- The device storage fallback (`localCopy: false`) adds "Not saved on this device" to the status line and a full sentence to the ring's value text and the Uploads row.
