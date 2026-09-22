# Apps package docs

Guides for `packages/apps` — app library structure, rollout, and per-domain reuse maps.

## Package reuse guides

| Package      | Shell                        | README                                |
| ------------ | ---------------------------- | ------------------------------------- |
| `mail-core`  | Collection (`WorkspaceApp`)  | [README](../src/mail-core/README.md)  |
| `drive-core` | Split (`WorkspaceAppLayout`) | [README](../src/drive-core/README.md) |
| `notes-core` | Collection (`WorkspaceApp`)  | [README](../src/notes-core/README.md) |
| `admin-core` | Split (`WorkspaceAppLayout`) | [README](../src/admin-core/README.md) |
| `lib/rtc`    | —                            | [README](../src/lib/rtc/README.md)    |

## Architecture

- [Workspace feature blueprint](../../../.agents/skills/workspace/feature-blueprint.md) — `*App`, `*Workspace`, controller, panes
- [App library rollout pattern](./rollout-pattern.md) — migrating routes to shared shell components

## Design / Storybook

- [Designer branding Storybook](./branding-storybook.md) — **`Branding/*` is the designer catalog** (accents, cream/ink, icons). Everything else lives under `Foundations/`, `UI/`, `Layout/`, and `Features/` (live shells under `Features/Workspace/Live/…`).
- [Color hex inventory](./color-hex-inventory.md) — leftover raw hex after brand primitives (brand / semantic / keep)
- [Type size inventory](./type-size-inventory.md) — raw `font-size` / `text-[Npx]` debt (snap vs keep)

## Quality gates

- [Apps done gate](../../../.agents/skills/testing/apps-done-gate.md) — `pnpm test:apps-done-gate`
