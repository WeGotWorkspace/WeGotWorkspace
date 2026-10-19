# Dark theme (beta)

Derived from [spec.md](./spec.md). A single chunk.

## Goal

See [spec.md](./spec.md#goal).

## Budget

A small beta bonus. It displaces nothing on the roadmap.

## Non-goals

See [spec.md](./spec.md#non-goals).

## What exists

- The four workspace surface/foreground pairs live on `:root`. `path: packages/apps/src/styles.css:129`
- Interactive washes derive from the local pair inside a `:where(...)` scope list. `path: packages/apps/src/workspace-shell/src/workspace-derive.css:1`
- Device settings follow the `meet-low-data` localStorage + event pattern. `path: packages/apps/src/meet-core/src/meet-low-data.ts:1`

## Considered

Considered: a `.dark` class with Tailwind `dark:` utilities (rejected: sheets use tokens, not utilities), and remapping `--color-we-got-dark` itself (rejected: it is a brand primitive that icon tiles also read). Chosen: a theme-pair tier above the workspace pairs.

## Affected packages

- packages/apps

## Dependencies

None.

## Open decisions

None — every choice for this work is made.

## Invariants

- Light is unchanged. The `:root` theme tokens resolve to the previous literals. Proof: `cmd: pnpm --dir packages/apps exec vitest run src/ui/portal-theme-vars.test.tsx src/branding-playground`
- Preference read, write, and resolution behave as specified. Proof: `path: packages/apps/src/lib/theme-preference.test.ts`

## Chunks

### Chunk A: theme tokens + Appearance pane

- **id:** `chunk-a-dark-theme`
- **Skill:** apps-ui
- **Inputs:** `path: packages/apps/src/styles.css:129`
- **Done when:** Dark renders in every workspace, and Settings → Appearance switches it live.
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/lib/theme-preference.test.ts src/settings-core`
- **Parallel with:** none

## Test plan

- [ ] Vitest: `theme-preference.test.ts`, settings sidebar/controller panel order
- [ ] Manual: Calendar, Notes, Docs, Drive, Tasks, Contacts, Meet, Settings in dark and light
