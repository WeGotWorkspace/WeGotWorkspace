Source: #414 (body-hash: 6d7768bf)
Goal: #412

# Notes sharing via Drive path ACL

Technical translation of Epic #414. Product context: Goal #412 (collaborate on Notes with team members — view/edit).

## Goal

Reuse Drive’s path-based share grants on `.notes` paths so signed-in users can share a single note or notebook with team members/groups (view/edit only). Provision `groups/{slug}/.notes/` for every group (create/seed + upgrade migration). Surface recipients in Notes as **Shared notebooks** (dir grants + group notebooks) vs **Shared with me** (file grants only). Keep Drive UI blind to `.notes`.

## Non-goals

- Guest / public link sharing (#388)
- Comment / review ACL (Notes has no comment UX)
- Full access share tier on Notes (Drive/Docs may keep full; Notes is view|edit only — archive/delete stay owner/group-member)
- Drive-visible `.notes` folders
- Vault / E2EE sharing (#391)
- New `notes_shares` table

## Affected packages

- `packages/api` — DriveShare note-path rules, Notes/collab auth, shared listings, group `.notes` ensure + wgw migration, OpenAPI, feature tests
- `packages/apps` — `share-ui` Notes mode; `notes-core` sidebar + open shared content

## Technical constraints

- Reuse `DriveShareService` / grants / `DriveShareAccess` — grants on `…/.notes/{notebook}/{id}.md` (note) or `…/.notes/{notebook}/` (notebook)
- Permissions subset: `view | edit` only; reject `comment` / legacy `review` / `full` on note paths
- Harden reads: force `mayComment` / `mayReview` / `mayManageStructure` false for note-path grants (legacy `full` rows keep edit content only)
- Drive `GET /files/shared-with-me` excludes `isNotePath`
- Notes listings thin-wrap the same grants, split by entry type (dir → notebooks, file → shared-with-me)
- Group lifecycle: ensure `files/groups/{slug}/.notes/` on create/seed; wgw migration one-level walk with cheap `directoryExists` skip
- Apps: Notes ShareDialog hides link/guest; wire Share on note + notebook; sidebar sections per Goal Decisions
- Handoff: `pnpm test:api-done-gate` / `pnpm test:apps-done-gate` as applicable; verify AC on child Tasks #415–#418

## Edge cases

- Bad legacy `comment` grant row on a note path → rights still `mayComment: false`
- Legacy `full` grant row on a note path → `mayEditContent: true`, `mayManageStructure: false`
- View grant: collab GET ok, PUT forbidden; edit: PUT ok
- Group already has `.notes` → migration second run is a no-op (no mtime touch)
- Membership notebooks (`groups/{slug}/.notes`) appear under Shared notebooks without ACL grant
- Drive listings never surface `.notes` as a normal folder
