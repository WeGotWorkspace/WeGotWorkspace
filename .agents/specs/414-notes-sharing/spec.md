Source: #414 (body-hash: 6d7768bf)
Goal: #412

# Notes sharing via Drive path ACL

Technical translation of Epic #414. Product context: Goal #412 (collaborate on Notes with team members — view/edit).

## Goal

Reuse Drive’s path-based share grants on `.notes` **note files** so signed-in users can share a single note with team members/groups (view/edit only). Provision `groups/{slug}/.notes/` for every group (create/seed + upgrade migration). Surface recipients in Notes as **Shared with me** (file grants). Group-membership notebooks appear under the main **Notebooks** sidebar (Users icon), not via notebook-directory ACL. Keep Drive UI blind to `.notes`.

## Non-goals

- Sharing a whole personal notebook directory via ACL (`…/.notes/{NotebookName}`)
- Guest / public link sharing (#388)
- Comment / review ACL (Notes has no comment UX)
- Full access share tier on Notes (Drive/Docs may keep full; Notes is view|edit only — archive/delete stay owner/group-member)
- Drive-visible `.notes` folders
- Vault / E2EE sharing (#391)
- New `notes_shares` table

## Affected packages

- `packages/api` — DriveShare note-path rules, Notes/collab auth, shared-with-me listing, group `.notes` ensure + wgw migration, OpenAPI, feature tests
- `packages/apps` — `share-ui` Notes mode; `notes-core` sidebar + open shared notes / group notebooks

## Technical constraints

- Reuse `DriveShareService` / grants / `DriveShareAccess` — grants on `…/.notes/{notebook}/{id}.md` (note file only); reject notebook-directory share creates
- Permissions subset: `view | edit` only; reject `comment` / legacy `review` / `full` on note paths
- Harden reads: force `mayComment` / `mayReview` / `mayManageStructure` false for note-path grants (legacy `full` rows keep edit content only)
- Drive `GET /files/shared-with-me` excludes `isNotePath`
- Notes `GET /notes/shared-with-me` lists file grants; `GET /notes/shared-notebooks` remains for contract compat but returns empty ACL items/notes
- Group lifecycle: ensure `files/groups/{slug}/.notes/` on create/seed; wgw migration one-level walk with cheap `directoryExists` skip
- Apps: Notes ShareDialog on single notes only (team view/edit); group notebooks listed under Notebooks with Users icon; Shared with me for file grants
- Handoff: `pnpm test:api-done-gate` / `pnpm test:apps-done-gate` as applicable; verify AC on child Tasks #415–#418

## Edge cases

- Bad legacy `comment` grant row on a note path → rights still `mayComment: false`
- Legacy `full` grant row on a note path → `mayEditContent: true`, `mayManageStructure: false`
- View grant: collab GET ok, PUT forbidden; edit: PUT ok
- Group already has `.notes` → migration second run is a no-op (no mtime touch)
- Membership notebooks (`groups/{slug}/.notes`) appear under Notebooks (Users) without ACL grant
- Drive listings never surface `.notes` as a normal folder
