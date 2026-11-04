Source: #1620 (body-hash: 9feca7d4)
Goal: WeGotWorkspace/Product#129

# Drive: upload a folder with its subfolders through the upload queue

Builds on the upload queue of Epic #1499 (#1501), the batch dialog (#1521) and the error states (#1522). The issue is the source of truth for every acceptance criterion; this file records the choices it leaves open.

## Goal

Choose or drop a folder, and Drive uploads it with all its files and subfolders, keeping the structure, through the same queue as files: offline, across reloads, with progress per folder.

## Non-goals

- Downloading a folder (WeGotWorkspace/Product#130).
- Guest folder upload, folder upload from other apps.
- Uploading several files at once, symlinks, permissions or timestamps.
- The `FileNode/set` creation-id references themselves (#1515).

## Affected packages

- packages/apps

## Decisions

- **Top-level name conflict.** One step in the batch dialog, after server space and before file conflicts: _Keep both_ (default; the folder is added as "Photos (1)") or _Merge_ (files go into the existing folder). With _Merge_, the file conflicts step lists the files whose names are taken inside the existing folder and its subfolders, with the usual Replace / Keep both / Skip. The step only shows when _Merge_ is possible: a name taken by a file, or by another upload still waiting, is kept both without asking. Nested folders always merge: anything below a folder this upload made is its own.
- **Folder creation without #1515.** #1515 is still open, so the uploader creates one folder per `FileNode/set` call, parents first, instead of the whole tree in one call. Each create is recorded before it is sent (`placing`) and the server id after (`placing.nodeId`); a retry after a lost answer or a reload finds the folder by that id or by its name in the same parent and never creates it twice. Moving to one call per tree is a follow-up once #1515 lands.
- **Data model.** No new table and no schema version: a folder is a `drive_upload_items` row with `kind: "folder"`. Files and child folders point at it with `targetFolder: {kind: "temporary", id}` and `inFolder`; once the folder exists, one transaction rewrites them to the server id. Subtree bytes and file counts are stored when the batch is added, so a folder's progress never goes back.
- **Failure.** A folder that cannot be created fails with its own reason (folder gone, no access, signed out…), and everything below it fails with the same reason. _Retry_ on a folder requeues it and what failed with it; _Retry_ on a file requeues its failed parent folders too. _Remove_ on a folder removes everything below it and refuses while a file in it is uploading; folders already made stay on the server.
- **Skipped names.** Names starting with "." (Drive hides them) and `Thumbs.db` / `desktop.ini`. A skipped folder is not read and counts once. A toast says "Left out 3 hidden or system items, like .DS_Store".
- **Folder rows.** A folder of an upload shows in its parent like other placeholders and opens (it lists what is uploading into it). Its status line covers everything below it: "Uploading · 42% · 2 files failed", and "Upload failed · 2 files failed" once nothing below it is still going. A folder that is waiting offline, for an answer, or for space says so like a file. _Choose another folder_ is not offered on folders.
- **Without the queue** (mock, guest) there is no _Upload folder_, and a dropped folder goes the old file path.
