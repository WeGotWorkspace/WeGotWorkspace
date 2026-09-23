# Story fixtures and harnesses

## Simple primitives

Use `args` and `argTypes` directly on the component — see `button.stories.tsx`.

## Complex panes

Use a **file-private harness** that wires controllers, forms, or mock data:

- `settings-profile-pane.stories.tsx` — `ProfileStoryHarness` + `SettingsStoryScope`
- Shared fixtures: `*.stories.fixtures.ts` (e.g. `settings-panes.stories.fixtures.ts`)

## Scope wrappers

Reuse product story scopes (e.g. `SettingsStoryScope`) to apply workspace CSS class + tokens on a minimal root.

Do not duplicate full app routing inside every story unless testing routing behavior.

## Router decorator

`.storybook/preview.ts` provides a TanStack Router decorator:

- Default path: `parameters.routerPath` (default `/notes`)
- Skip router + toaster wrapper: `parameters.wegotworkspaceRouter: true` when the story supplies its own shell

## Mock bootstrap library

Prefer fixtures from `@/lib/api/mock/`:

- `createSettingsAppBootstrap`, `createMailAppBootstrap`, `createDriveAppBootstrap`, …
- `createMockDocsOperations`, `createInstallerAppBootstrap`, etc.

Stories must not import `@/lib/api/wgw/http` for data loading. See [offline-first.md](offline-first.md).

For write flows, pass no-op or mock `operations` / slice handlers — see [workspace/feature-blueprint.md](../workspace/feature-blueprint.md).

## File layout

```
feature-core/
├── src/
├── stories/
│   ├── feature-pane.stories.tsx
│   └── feature.stories.fixtures.ts
```

Keep fixtures next to stories; import types from `src/`, not duplicated mock shapes.
