# Plugins

> **Not available in the beta.** The plugin subsystem is disabled by default
> (`WGW_PLUGINS_ENABLED`, default `false`). The REST endpoints are not registered, no plugin
> routes are served, and there is no Admin → Plugins pane. This document describes the contract
> as it will return after the beta.

Optional product features ship as **plugins**. They are always installed separately from the core WeGotWorkspace release — never bundled in the deploy ZIP.

## First-party and third-party

| Source | Where it lives |
|--------|----------------|
| **First-party** | [WeGotWorkspace/plugins](https://github.com/WeGotWorkspace/plugins) — official plugin packages and releases |
| **Third-party** | Any vendor or project — allowed when the package **conforms to the plugin standards** below |

Core does not distinguish first- vs third-party at runtime: discovery, routing, and APIs are the same for every installed plugin that meets the contract.

## Plugin standards

Third-party (and first-party) plugins must follow these rules. Core implements the contract in `PluginRegistryService`, `PluginHtmlResponder`, and the OpenAPI **Plugins** routes.

### On-disk layout

After install, each plugin lives under:

`wgw-plugins/{plugin-id}/`

(with `plugin.json` and `assets/` directly under that folder — not nested twice under `wgw-plugins/`).

```
wgw-plugins/my-plugin/
  plugin.json
  assets/
    index.html          # required for runtime.indexReady
    editor.html         # optional; editor.html or editor/index.html for runtime.editorReady
```

### Admin ZIP layout

Upload ZIPs use a single top-level folder matching the plugin id:

```
my-plugin/plugin.json
my-plugin/assets/index.html
my-plugin/assets/editor.html   # optional
```

Install via **Admin → Plugins** or unpack manually into `wgw-plugins/`.

### `plugin.json` manifest

| Field | Required | Purpose |
|-------|----------|---------|
| `id` | yes | Stable plugin id; must match the install folder name |
| `name` | yes | Display name |
| `active` | no | Default active state (default `true`) |
| `appTile` | for UI routes | Shell tile and static UI route (`id`, `label`, `route`, optional `icon`) |
| `drive` | for Drive open/create | `openFileExtensions`, `openFileRoute`, `openFileQueryParam`, `newFileTemplates` |
| `integration` | for editor/session | See below |

**`integration`** (optional, for editor-style surfaces):

| Field | Purpose |
|-------|---------|
| `configGlobal` | Global name for injected config (default `__WGW_PLUGIN_CONFIG__`) |
| `sessionApiPath` | Path the shell calls before opening the editor (usually `/api/v1/plugins/{id}/session`) |
| `saveTransport` | Hint for the client (e.g. drive upload); saves use **Drive API / WebDAV**, not plugin-specific core endpoints |
| `editorPaths` | URL segments served as editor HTML (default `editor`, `editor.html`) |

Example:

```json
{
  "id": "my-plugin",
  "name": "My plugin",
  "active": true,
  "appTile": {
    "id": "my-plugin",
    "label": "My plugin",
    "route": "/apps/my-plugin"
  },
  "drive": {
    "openFileExtensions": ["docx"],
    "openFileRoute": "/apps/my-plugin/editor",
    "openFileQueryParam": "file"
  },
  "integration": {
    "sessionApiPath": "/api/v1/plugins/my-plugin/session",
    "saveTransport": "drive-upload",
    "editorPaths": ["editor", "editor.html"]
  }
}
```

When a user opens a plugin route, core injects `window.{configGlobal}` into the HTML with site context (`base_uri`, `auth_realm`, `username`, `plugin_id`, `plugin_route`, and integration fields).

### Core HTTP API

| Endpoint | Purpose |
|----------|---------|
| `GET /api/v1/plugins` | List installed plugins, capabilities, and `runtime` readiness |
| `POST /api/v1/plugins/{id}/activate` | Activate a discovered plugin |
| `POST /api/v1/plugins/{id}/deactivate` | Deactivate a plugin |
| `POST /api/v1/plugins/{id}/session` | Establish the browser UI session cookie for plugin surfaces |

OpenAPI: `packages/api/openapi/openapi.json` (**Plugins** tag). TypeScript shapes: `packages/apps/src/lib/api/wgw/types.ts` (`WgwPluginDescriptor`).

### Document I/O

Plugin file saves use **Drive API** and **WebDAV** from the plugin client. Core does not expose plugin-specific document save endpoints.

## Install

**First-party:** download a release ZIP from [WeGotWorkspace/plugins releases](https://github.com/WeGotWorkspace/plugins/releases).

**Third-party:** use the vendor’s ZIP if it matches the layout and manifest rules above.

Then open **Admin → Plugins** and upload the ZIP (or unpack manually under `wgw-plugins/`).

## Verify

- `GET /api/v1/plugins` lists the plugin as active with `runtime.indexReady: true` when assets are present
- The plugin’s declared `appTile.route` loads in the browser
- `POST /api/v1/plugins/{id}/session` establishes the UI session cookie when required
- Drive opens matching extensions via the manifest `drive` hooks

Build and release **first-party** plugins from [WeGotWorkspace/plugins](https://github.com/WeGotWorkspace/plugins), not from this monorepo.
