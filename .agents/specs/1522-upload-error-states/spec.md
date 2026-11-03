Source: #1522 (body-hash: f0c84486)
Goal: WeGotWorkspace/Product#140

# Drive uploads: pause and error states, sign-out and leave warnings

Third UI slice of Epic #1499, on top of the queue (#1501), the chunked client (#1519), the space checks (#1520), and the batch dialog (#1521). The issue is the source of truth for every acceptance criterion; this file records the choices the issue leaves open.

## Goal

Every way an upload can stop tells the user what happened and what to do: the server is full, the folder is gone, write access is gone, the server is not on https, or the session ended. Signing out or closing the last tab while files wait asks first. The floating progress bar is gone; the placeholders, the Uploads view, and the toasts carry the progress.

## Non-goals

- Pausing or reordering the queue by hand.
- Guest uploads through the queue (#1715 / #1716): a guest's sign-in is the share page, which those issues own.
- Folder upload (#1620).

## Affected packages

- packages/apps

## Decisions

- **Server full.** A warning callout on top of the Uploads view ("Uploads are paused: the server is full"), with the trash hint and _Retry_ (`resumeUploadQueue`). The Uploads sidebar badge shows a pause sign; screen readers hear "3 files, paused, the server is full". Rows keep saying "Waiting for space on the server".
- **Folder gone (`target_missing`) and write access gone (`forbidden`).** Both offer _Choose another folder_: the folder picker of _Move to_ with its own title ("Choose a folder for Minutes.docx") and button ("Upload here"), calling `retargetQueuedUpload`. `forbidden` also keeps _Retry_ (access may come back) and says to ask the owner; it never prompts sign-in. The action is in the Uploads view and in the placeholder's menu.
- **No https (`insecure_context`).** Only _Remove_. The row says to ask the administrator; administrators (`useShowAdminApp`) also get an _Open Admin_ link to `/admin`, where the not-secure notice from #1526 stands.
- **Signed out (`auth`).** _Retry_ with no session left sends the user to `/login?return=/drive?view=uploads` and leaves a one-time flag in `sessionStorage`; back in Drive, the `auth` files (or, after _Retry all failed_, every failed file) go back to the queue. With a session still in place, _Retry_ retries at once: there is nothing to sign in to.
- **Sign-out warning.** On the `/logout` screen, beside the existing unsynced-changes and offline warnings, in one dialog: "Uploads are not finished", the file count, _Wait_ (opens `/drive?view=uploads`) and _Sign out anyway_. The count reads `drive_upload_items` of every account database the wipe deletes, so it works from any app. A failing count does not block sign-out.
- **Leave warning.** The browser's own `beforeunload` prompt, only while the queue is `running` and no other tab holds or waits for the account's uploader lock (`navigator.locks.query()`, checked every 3 s). Without the Web Locks API every tab warns. Waiting files (offline, server full) stay queued on the device, so those states do not warn.
- **Floating bar removed.** `upload-progress/` and its styles go. A direct upload (mock or guest Drive, no queue) shows an "Uploading report.pdf" toast when it starts and the existing "Uploaded" toast when done.
- **Destructive buttons in the dark theme.** The new dark sign-out story failed the contrast gate: `--destructive-foreground` was the dark theme's on-ink (#111, 3.4:1 on the error red). It is now white in both themes (5.6:1); light mode does not change.

## Edge cases

- A tab that was not uploading (another tab held the lock) and closes does not warn; the uploading tab still does when it is the last one.
- _Wait_ on the sign-out dialog does not sign out and does not go back in history; it opens Uploads, where the queue runs.
- A sign-in that the user abandons leaves the flag; the next Drive load in that tab retries the `auth` files then.
