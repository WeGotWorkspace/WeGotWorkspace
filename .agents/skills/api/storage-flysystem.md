# Storage (Flysystem — single API)

All **user/group files**, **office documents**, and **WebDAV file nodes** go through Laravel **Flysystem** (`Storage` facade or injected `Illuminate\Contracts\Filesystem\Filesystem`).
**One path policy, one adapter config** — not scattered `Paths::data()` + PHP filesystem calls.

Notes bodies are **not** Flysystem files: they are CalDAV VJOURNAL `DESCRIPTION` rows (PDO). The `wgw_notes` disk is leftover/migrator plumbing, not the Notes store.

## Configuration (`config/filesystems.php`)

Define explicit disks (names are examples; keep stable once chosen):

| Disk | Root | Used for |
|------|------|----------|
| `wgw_data` | install `data/` dir | updates log, locks, secrets, non-DAV state |
| `wgw_files` | `data/files/` | drive, office, WebDAV tree (`users/`, `groups/`) |
| `wgw_notes` | same `data/files/` root as `wgw_files` (legacy) | leftover `.notes` trees / migrator only — not the VJOURNAL store |

- Resolve roots from `WGW_*` keys in `packages/api/.env` in a **service provider** (set disk roots at boot) — not `Paths::data()` in services.
- Optional later: `s3` disk with same logical paths; domain code stays on `Storage::disk('wgw_files')`.

## Application boundary

- **`App\Storage\WgwStorage`** (or `FilesystemService`): thin wrapper registering disks, exposing `files()`, `notes()`, `data()` helpers.
- **Path policy** in `App\Storage\StoragePaths` / `DrivePathPolicy`: virtual paths (`/users/alice/...`), ACL checks, normalization — **no** duplicate logic in drive vs office vs DAV.
- **Services/Repositories** inject `WgwStorage` or specific disk — never build absolute paths with `Paths::`.

```php
// ✅
public function __construct(private WgwStorage $storage) {}
$this->storage->files()->put($relativePath, $contents);

// ❌
file_put_contents(Paths::data().'/files/'.$path, $contents);
```

## SabreDAV / WebDAV

- File tree nodes (`IFile` / `ICollection`) **delegate to the same Flysystem disk** as REST drive/plugins — not a second copy of `data/files` logic.
- Implement under `app/DAV/Storage/` (e.g. FlysystemCollection, FlysystemFileNode) or a maintained Sabre↔Flysystem bridge.
- **Plugins** (git versioning, write guard) call Laravel **services** that use `WgwStorage` — no `readfile` / direct path in plugins.
- CalDAV/CardDAV stay on PDO backends; only **file** WebDAV shares the files disk.

## Notes

- Product notes are CalDAV VJOURNAL (`NoteRepository` / `NotebookRepository`), not markdown files under `.notes/`.
- Leftover Drive `.notes` trees (migration source) still go through Flysystem when a migrator or FileNode index touches them — never ad hoc `mkdir` + `file_put_contents`.

## Forbidden

- `Paths::data()`, `file_get_contents`, `file_put_contents`, `readfile`, `is_file`, `scandir` in `app/Services/`, `app/Repositories/`, `app/Http/`
- Separate filesystem roots computed differently in Drive, Office, Notes, and `SabreApp`
- "Temporary" direct disk access in new code "until we add Flysystem"

## Tests

- `Storage::fake('wgw_files')` (and `wgw_notes` if separate) in feature/unit tests
- Assert paths via storage API, not `$tmpDir` string concat unless bootstrapping fake disk root
