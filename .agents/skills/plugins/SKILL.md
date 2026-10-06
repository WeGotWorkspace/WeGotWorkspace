---
name: plugins
description: Installable UI plugins for WeGotWorkspace — registry, activation, ZIP install, static assets, and Flysystem/WebDAV boundaries. Use when working on plugin.json, PUT /admin/plugins/{id}/activation, or wgw-plugins/.
paths:
  - "packages/api/app/Services/Plugins/**"
  - "packages/api/app/Http/Controllers/Api/V1/Plugins/**"
  - "apps/wegotworkspace/wgw-plugins/**"
  - "packages/api/tests/Feature/Plugins/**"
---

# Plugins

Plugins are **installed ZIP packages** under `wgw-plugins/{id}/` with a `plugin.json` manifest and built static assets. Laravel discovers them via `PluginRegistryService`; the UI loads active plugin routes through `PluginHtmlResponder`.

## Quick decision matrix

| Task | Read |
|------|------|
| REST routes / OpenAPI | `packages/api/openapi/openapi.json` (`/plugins`, `/admin/plugins/{id}/activation`) |
| Registry + activation | This file |
| Install from ZIP (admin) | `packages/api/app/Services/Plugins/PluginInstallerService.php` |
| Paths + assets | `packages/api/app/Services/Plugins/PluginPaths.php` |
| File I/O policy | [api/storage-flysystem.md](../api/storage-flysystem.md) |
| WebDAV write restrictions | `packages/api/app/Dav/Server/WebdavWriteGuardPlugin.php` |
| Feature tests | `packages/api/tests/Feature/Plugins/` |

## Layout on disk

| Path | Purpose |
|------|---------|
| `{install}/wgw-plugins/{id}/plugin.json` | Manifest (`id`, `name`, `active`, `appTile`, `drive`, `integration`, …) |
| `{install}/wgw-plugins/{id}/assets/index.html` | App tile entry (required for registry listing) |
| `{install}/wgw-plugins/{id}/assets/editor.html` or `editor/index.html` | Optional editor surface |

`PluginPaths` resolves manifests and index paths — **no direct `scandir` in controllers**.

## Activation

- **Default active** from manifest `active: true` unless overridden.
- **Runtime toggle:** `PUT /api/v1/admin/plugins/{id}/activation` with `{ "active": true|false }` → `ActivationController`. Admin only.
- Overrides persist in `app_settings` key `plugins_active_overrides` via `PluginRegistryService::setActive`.

Admin listing also exposes plugins at `/api/v1/admin/plugins` (install/upload flows).

## Install flow (admin ZIP)

`PluginInstallerService`:

1. Validate `.zip`, size cap (512 MiB), safe zip entries
2. Extract to temp under `storage/framework/cache/`
3. Require readable `plugin.json`
4. Copy into `wgw-plugins/{id}/`

Do not extract archives outside the plugins root. Do not bypass `SafePath` checks.

## Flysystem boundary

Plugins that touch **user files** (versioning, write guard, drive integration) must call Laravel **services** using `WgwStorage` / `Storage::disk('wgw_files')` — not `readfile`, `Paths::data()`, or ad hoc paths in plugin PHP.

Same files disk as REST drive and WebDAV file nodes — see [storage-flysystem.md](../api/storage-flysystem.md).

## WebDAV write guard (not a plugin package)

`WebdavWriteGuardPlugin` is a **Sabre server plugin** registered in `SabreServerFactory`. It blocks destructive mutations under `principals/` and stray `files/` paths while allowing normal CalDAV/CardDAV/file edits under allowed subtrees.

Do not reimplement path guards in plugin PHP — use this server plugin + storage services.

## UI integration

Active plugins with `appTile.route` serve static HTML from `assets/index.html`. Drive integration fields (`openFileExtensions`, `newFileTemplates`, …) and `integration.sessionApiPath` are normalized in `PluginRegistryService::normalizeManifestPlugin`.

## Tests

```bash
cd packages/api && composer test -- --filter Plugins
```

Cover activation toggles, registry listing, and install validation in `tests/Feature/Plugins/`.

## Forbidden

- Direct filesystem I/O in new plugin-related domain code outside `PluginPaths` / Flysystem services
- Skipping activation override persistence (must use `AppSetting`)
- Serving plugin assets without checking `active` flag in registry

## Related skills

- API layering: [api/SKILL.md](../api/SKILL.md)
- Workspace app tiles: [workspace](../workspace/SKILL.md)
