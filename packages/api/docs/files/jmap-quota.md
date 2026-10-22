# JMAP Quota (RFC 9425) for Drive

> **Issue:** #1500 (API slice of Epic #1499) · **Spec:** `.agents/specs/1500-chunked-upload-api/spec.md`

The session advertises `urn:ietf:params:jmap:quota` as an empty object in both the Session `capabilities` and the account's `accountCapabilities`. The capability is gated by the same `files_enabled` setting as `urn:ietf:params:jmap:filenode`.

Methods: `Quota/get`, `Quota/changes`, `Quota/query`, `Quota/queryChanges`.

## One quota per writable root

There is one `octets` quota per root the account can write to:

- its personal drive, `users/{username}`
- each group drive it is a member of with write access, `groups/{slug}`

Share roots granted to the account are not quota roots. A group drive's bytes are counted once, under the group's quota, never per member or per grantee.

| Property | Value |
|----------|-------|
| `id` | `dq-{rootNodeId}` — the root's FileNode `node_id`, which survives renames; never the slug or the path |
| `resourceType` | `"octets"` |
| `used` | sum of `size_bytes` of live file rows under the root |
| `hardLimit` | `used + free disk space` |
| `scope` | `"account"` |
| `name` | `"Personal drive"`, or the group's display name (slug as fallback) |
| `types` | `["FileNode"]` |
| `description` | `null` |

RFC 9425 has no "free" property: free space is `hardLimit − used`. It is the same disk free space for every root, so a client's pre-check against the batch's target root is not blind to a filling group drive.

The Drive quota is returned only when `urn:ietf:params:jmap:filenode` is in `using` (RFC 9425 §4.1: types the client did not request are filtered out, and a quota with no recognized type is not returned).

## `used`

`used` is an indexed prefix sum over `jmap_file_nodes` (`storage_key`, `deleted_at`): live rows (`deleted_at IS NULL`) that are files, with `storage_key LIKE 'root/%' ESCAPE '!'`. Tombstones kept for `/changes` do not count; `.Trash` is a real folder, so trash counts. The LIKE escape is `!`, not a backslash, because a backslash `ESCAPE` clause is a syntax error on MySQL.

Files written outside WGW count once the index has discovered them (a listing or `wgw:jmap:filenodes-reindex`).

## `hardLimit` and free space

Free space comes from one interface (`App\Services\Jmap\Blobs\FreeSpaceSource`, today `disk_free_space()` of the `wgw_files` root), so a configured soft limit can replace it later without changing the client.

- If free space is unknown (`disk_free_space()` returns `false`), no Drive quota is returned, so the client skips its up-front warning.
- On shared hosting `disk_free_space()` often reports the whole disk, not the account's hosting quota. A write the host refuses anyway ends as a 507 / `overQuota`, never a generic 500.
- **Known and accepted:** `hardLimit` drifts with other tenants' activity on the same disk, so `Quota/changes` may report changes this account did not cause.

## State and changes

The state string encodes a map of quota id → a short fingerprint of `(used, hardLimit, name)`. `Quota/changes` decodes `sinceState` and compares it with the current quotas, so it reports `created`, `updated`, and `destroyed` exactly without storing anything; `maxChanges` returns an intermediate state with only the reported changes applied. `updatedProperties` is `null`. A state this server did not issue answers `cannotCalculateChanges`.

`Quota/query` filters on `name` (contains), `scope`, `resourceType`, and `type`, and sorts by `name` and `used`. `Quota/queryChanges` always answers `cannotCalculateChanges`.
