# Component design

Extends primitive API rules in [SKILL.md](SKILL.md). For *App / *Workspace splits see [workspace/feature-blueprint.md](../workspace/feature-blueprint.md).

## Layers

| Layer | Responsibility | Example |
|-------|----------------|---------|
| Primitive | Behavior + generic styling via CSS vars | `Button`, `Input`, `Card` |
| Composite | Composes primitives; still reusable | `FieldLabelRow`, `ViewHeader` |
| Pane | Product section; workspace-scoped CSS | `SettingsProfilePane` |
| Workspace | Layout shell + nav | `SettingsWorkspace` |
| App | Routing, API wiring, callbacks | `SettingsApp` |

## Props design

- **Behavior props** over presentation props: `variant`, `disabled`, `onClick` — not `toolbarStyle`.
- **Descriptor arrays** for actions: `{ id, label, icon, onClick, active }[]` — not ad-hoc dropdown JSX at callsites.
- **Callbacks upward** for shell-owned flows: `onLogout`, navigation — workspace must not call `window.location` ([workspace](../workspace/SKILL.md#navigation-and-logout), lint-enforced).
- Optional props with sensible defaults; avoid required props that are always the same at every callsite.

## Dependency injection (target standard)

**Goal:** one consistent pipeline so every layer is testable without module mocks. Side effects enter **only through props** — never by importing `@/lib/api/wgw/*` inside panes, composites, or primitives.

**Lint:** `paneAndStoryImportRules` in [`packages/apps/eslint.config.js`](../../../packages/apps/eslint.config.js) fails CI when a `*-pane.tsx` file or a story file (`*.stories.ts(x)`, `*.stories.*.ts(x)`) imports `@/lib/api/wgw/http`, a relative path to it, or the `@/lib/api/wgw` barrel that re-exports it.

### Target pipeline (all new work)

```text
*App  →  use*API / createOperations()  →  operations
       →  use*Controller({ operations })  →  slices (data + bound handlers)
       →  *Pane({ profile | mail | … })  →  primitives (onClick only)
```

| Layer | Receives | Calls API? |
|-------|----------|------------|
| **`*App`** | route, API base URL | Builds **`operations`** via `use*API` |
| **`use*Controller`** | optional **`operations`** | **Only** layer that invokes `operations.*` (besides App wiring) |
| **`*Pane`** | **slice** (data + handlers like `saveProfile`) | **Never** — handlers already bound upstream |
| **Primitive / composite** | `onClick`, `onChange`, … | **Never** |

Reference: [feature-blueprint](../workspace/feature-blueprint.md) (`operations` optional in stories).

**Pane props use slice handlers, not `saveFn`.** The injected dependency is the handler on the slice (`profile.saveProfile`), wired in the controller from `operations`. Same idea as `saveFn`, different shape — **one convention for product UI**.

```tsx
// ✅ target — pane
<SettingsProfilePane profile={profile} />

// ✅ target — controller binds operations to slice
const saveProfile = form.handleSubmit(async (values) => {
  await operations?.saveProfile?.(mapProfile(values));
});

// ❌ avoid — pane imports API
function SettingsProfilePane() {
  await wgwFetch("/settings/profile", …);
}
```

### When `*Fn` / `on*` is allowed

Use **`*Fn` + `on*`** only for **shared, product-agnostic** components (candidates for `@/ui`), not for `*-core` panes:

| Context | Convention |
|---------|------------|
| Product pane (`*-core`) | **`operations` → slice handlers** |
| Shared generic widget | **`*Fn`** (work) + **`on*`** (after) |

Do not mix `saveFn` on a settings pane and `operations` on admin — product code follows the slice pattern.

### Naming (slice handlers)

| Prop | Purpose |
|------|---------|
| `saveProfile`, `refreshState`, … | Bound handler on a domain slice (preferred for panes) |
| `onLogout`, `onNavigate`, … | Shell callbacks ([workspace](../workspace/SKILL.md)) |
| `saveFn`, `fetchFn` | Shared generic components only |

### Tests (Vitest)

Mock at the **prop boundary** — inject fake `operations` in controller tests, or pass slices with `vi.fn()` handlers to panes:

```tsx
const saveProfile = vi.fn().mockResolvedValue(undefined);
render(<SettingsProfilePane profile={{ …profile, saveProfile }} />);
await userEvent.click(screen.getByRole("button", { name: /save/i }));
expect(saveProfile).toHaveBeenCalled();
```

See [testing/ui-architecture.md](../testing/ui-architecture.md).

### Storybook

- **Workspace stories:** omit **`operations`** or pass no-ops; slices use stub handlers (see settings harnesses).
- **Shared widget stories:** stub **`saveFn`** / **`on*`** in `args`.

### Residual debt (incremental)

Product **controllers, hooks, mock ops, and workspaces** for meet, docs, drive, mail, and install follow the target pipeline ([#77](https://github.com/WeGotWorkspace/wegotworkspace/pull/77)). Remaining gaps are incremental — fix when you touch the area:

- **`@/lib/api/wgw/*` in app shells** — e.g. `wegotworkspace-*`, `docs-app` collab URL wiring, `login-core` (live bootstrap / auth routes)
- **Direct API calls in panes or composites** (outside `*-api-source`)
- **Ad hoc `*Fn` on product panes** instead of slice handlers
- **Missing `operations?`** — component unreachable in stories without module mocks

**Do not** block feature work to refactor unrelated files. **Do** follow the target for code you touch; file new issues for remaining debt.

### Filing refactor issues

When you find a violation outside current task scope, open a GitHub issue (label `refactor` / `tech-debt` if available):

**Title:** `refactor(apps-ui): inject operations in <area> — remove direct wgw imports`

**Body template:**

```markdown
## Target pattern
App → operations → controller → pane slices (`.agents/skills/apps-ui/components.md`)

## Current violation
- File: `packages/apps/src/…`
- What: imports `@/lib/api/wgw/…` in controller | pane | …

## Proposed change
- Move calls behind `operations` on `*APIOperations`
- Pass slice handlers to panes
- Update stories/tests to use prop injection

## Acceptance
- [ ] No `@/lib/api/wgw` imports in listed pane/composite files
- [ ] Controller uses `operations?.*` only (or documents exception)
- [ ] Story renders without live API
- [ ] Tests mock props, not modules
```

Track new refactor issues on GitHub (label `refactor` / `tech-debt` if available); link to [apps-ui/components.md](components.md) for the acceptance checklist.

## Composition

- Reuse `@/ui` and shared packages before inventing product-prefixed clones.
- Promote to `@/ui` only when **two or more products** need identical behavior.
- File-private story/pane helpers (`Sidebar`, `MainHeader`) are fine when they reduce noise without hiding reusable API.

## Styling split

- Structure/layout class names in TSX.
- Visual contract in co-located or workspace CSS files.
- Dynamic runtime values (percent widths, measured sizes) may stay inline in TSX.

## Accessibility

Semantic HTML and labels: [accessibility](../accessibility/SKILL.md).

## TypeScript

Exported prop types and conventions: [typescript.md](typescript.md).

## Stories

Every significant export needs catalog coverage: [storybook](../storybook/SKILL.md).
