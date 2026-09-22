# Notes Core Reuse Guide

`notes-core` exposes reusable building blocks for notebook-style list/detail apps with batch selection and tag/notebook management.

## Shell pattern

**Collection** — `NotesWorkspace` composes `WorkspaceApp` (list column + detail column) with sidebar chrome from `AppSidebar`. Mail-style split panes without `WorkspaceAppLayout`. See [feature blueprint](../../../../.agents/skills/workspace/feature-blueprint.md) for controller/pane layering.

## Reusable exports

Public (`src/notes-core/src/index.ts`):

- `NotesApp` (`src/notes-core/src/notes-app.tsx`)
- `NotesWorkspace` (`src/notes-core/src/notes-workspace.tsx`)
- `useNotesAPI`, `createDefaultNotesApiSource` (`src/notes-core/src/use-notes-api.ts`, `notes-api-source.ts`)
- `NotesAPIOperations`, `NotesUIData`, `DeleteNotebookAction` (`src/notes-core/src/notes-types.ts`)
- `defaultNotesLabels`, `mergeNotesLabels` (`src/notes-core/src/notes-labels.ts`)

Internal composition:

- `useNotesController` (`src/notes-core/src/use-notes-controller.tsx`) — thin composer
- `useNotesShell`, `useNotesList`, `useNotesMutations` — domain slices
- `NotesListPanel`, `NotesDetailActionBar`
- Shared detail/multi-select: `@/note-detail-view`, `@/multi-selection-view`, `@/dialogs`

## Provider wiring

Implement `NotesAPIOperations` (or inject `NotesApiSource`) and pass `data`, `session`, and `operations` into `NotesWorkspace`.

`NotesApp` wires `useNotesAPI` → `WorkspaceLiveAppShell` → `NotesWorkspace`. Mock bootstrap: `createNotesAppBootstrap` in `@/lib/api/mock/notes-bootstrap`.

## Styling

List and workspace tokens live under `.notes-workspace` in `notes-workspace.css`; list rows in `notes-list-panel.css`. Storybook stories use `stories/notes-story-scope.tsx` (`NotesStoryScope` with `pane` / `list-column` / `detail` variants) so production root classes apply.

## Storybook

| Story                                    | Purpose                                        |
| ---------------------------------------- | ---------------------------------------------- |
| `Themes/Notes`                           | Full workspace chrome + branding knobs         |
| `Features/Notes`                         | Shared-notebook sidebar layout (non-branding)  |
| `Features/Notes/Panes/List`              | List column harness                            |
| `Features/Notes/Panes/Detail`            | Note detail view                               |
| `Features/Notes/Panes/Detail action bar` | Detail toolbar variants                        |
| `Features/Notes/Panes/Multi selection`   | Batch selection surface                        |
| `Features/Workspace`                     | Full shell (login → home → all apps, mock API) |

## Further reading

- [Workspace feature blueprint](../../../../.agents/skills/workspace/feature-blueprint.md) — `*App` / `*Workspace` / controller / pane split
- [Apps docs index](../../docs/README.md)
