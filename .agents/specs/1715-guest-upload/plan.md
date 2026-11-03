# Guests upload into a shared folder: plan

Derived from [spec.md](./spec.md). Two sequential chunks, one builder. Source Task #1715.

## Chunks

| Chunk | What | Ships alone? |
|-------|------|--------------|
| A — API | Link levels (`edit` on folder links), guest JMAP gateway (session, API, upload), guest account context, guest write rules, guest rights, share limiter and byte budget, OpenAPI, feature tests | Yes. No UI offers an `edit` link yet; owners can only make one through the API. Members are unchanged. |
| B — Client | Guest upload queue wiring, guest Session and root resolution, Drive upload gate for guests, share dialog link level, story, e2e | Needs A on `main`. Changes what people see, so it waits for the product lead's test. Closes #1716. |

## Invariants

- A member request never reaches the guest gateway, and a guest request never reaches a member JMAP route (route role checks, not name checks). Proof: `path: packages/api/tests/Feature/Jmap/JmapGuestUploadAclTest.php` assertion `test_guests_and_members_keep_to_their_own_jmap_routes`, and `path: packages/api/tests/Architecture/RoleAccessMatrixTest.php` for every `guest-only` operation.
- The guest account context is filled only by the gate for the authenticated guest. Proof: `path: packages/api/tests/Feature/Jmap/JmapGuestUploadAclTest.php` assertion `test_two_guests_of_one_link_do_not_share_blobs`.
- Every guest JMAP request re-checks session, share, and rights before reading a body. Proof: `path: packages/api/tests/Feature/Jmap/JmapGuestUploadAclTest.php` assertions `test_an_upload_stops_when_the_owner_revokes_the_link_mid_upload` and `test_the_next_request_is_refused_after_the_link_changes`.
- A guest cannot destroy, rename, move, or create folders through `FileNode/set`, whatever the link level. Proof: `path: packages/api/tests/Feature/Jmap/JmapGuestUploadAclTest.php` assertion `test_a_legacy_full_link_still_gives_guests_no_structure_changes`.
- Limits key on the share and run after authentication. Proof: `path: packages/api/tests/Feature/Jmap/JmapGuestUploadLimitsTest.php`.

## What exists

- Guest authorization checks session and share liveness, owner reach, trash, and scope. `path: packages/api/app/Services/Drive/DriveShareAuthorizer.php:223`
- Guest sessions come only from public link tokens. `path: packages/api/app/Services/Drive/DriveShareService.php:483`
- JMAP adds children only with `full` (`mayManageStructure`). `path: packages/api/app/Services/Jmap/FileNodes/FileNodeMapper.php:224`
- Upload server: #1500, [spec](../1500-chunked-upload-api/spec.md).
- Upload client: the queue's transfer step. `path: packages/apps/src/lib/offline/drive/upload/drive-upload-transfer.ts:88`

## Open decisions

None — the spec settles link levels, account shape, method list, write rules, and limits.

## Considered

- **Open the member JMAP routes to guests and filter inside.** Rejected: one missed check in any of 40 methods hands a guest the whole envelope. Separate routes plus a short method list fail closed.
- **A guest REST upload API.** Rejected: #1715 asks for the same queue, parts, assembly, and version check; the queue speaks JMAP.
- **Account id = `share:{sessionKey}`.** Rejected: not a JMAP Id, and it would put the session key in URLs and on disk.
- **Account per share instead of per session.** Rejected: two guests of one link would share a blob space, and content-addressed ids would let one attach the other's bytes by hash.
- **`edit` adds no children for guests (same as members).** Rejected: then only `full` could upload, and `full` would also promise rename and delete. The issue asks for `edit`.
- **Allow `full` links.** Rejected for now: guests get no structure changes (#1712).
- **Expose `Quota/get` to guests.** Rejected: it shows the owner's usage and free space to anyone with the link. The client's space check reads "unknown".
- **Byte cap only on the service.** Rejected (security skill): PHP-FPM resets it. The budget lives in shared cache and is charged before the body is read.
