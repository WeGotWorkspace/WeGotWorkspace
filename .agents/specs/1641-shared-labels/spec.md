Source: #1641 (body-hash: 47b008d0)

# One shared label base (#1641 step b)

Technical translation of step (b) of #1641. Steps (a), (c) and (d) are out of scope.

## Goal

User-visible copy lives in per-app `*-labels.ts` files. Common strings ("Cancel", "Delete", "Remove access?", "Pending sync", …) are typed out again in every file. This work grows the seed in `packages/apps/src/lib/workspace/destructive-dialog.ts` into one typed shared base, `workspaceLabels` in `packages/apps/src/lib/workspace/workspace-labels.ts`, grouped by concern: dialog verbs, sharing, sync state and list chrome. Every app label file takes its common strings from that base, and every app merge function (`mergeNotesLabels`, `mergeTasksLabels`, …) becomes a thin binding over one generic `mergeWorkspaceLabels`.

A snapshot test resolves every label bag (strings, nested records, and function labels called with fixed probe arguments) and is committed before any label file changes. Every later commit must keep it green, which proves that no visible text changed.

## Non-goals

- No visible text change. Inconsistencies found on the way (for example "could not sync" vs "couldn’t sync") stay as they are and are listed for the product lead.
- No renaming of app label keys. Keys such as `removeNotebookShareTitle` or `cancel` stay, so callsites, stories and `labels` overrides keep working.
- No i18n layer, no runtime locale switching.
- Strings that look the same but mean different things ("None" as an alarm choice vs a paper size, "New" as a tab vs a button, "Today", "Location") are not moved.

## Affected packages

- packages/apps
- .agents (spec, workspace skill note)

## Technical constraints

- People-picker copy (placeholder, section hint, remove confirm) stays in `sharePrincipalCopy` (`share-ui/share-labels.ts`), which #1980 added; the base does not duplicate it.
- `as const` label bags (`docsLabels`, `driveLabels`, `meetLabels`, `chatUiLabels`, `shareLabels`) derive their type with `typeof`. The base is declared `as const` too, so a moved value keeps its literal type and these derived types do not change.
- One app per commit, so a label-file conflict with the import/export branch stays local to one commit.
- The merge binding keeps today's behaviour: no overrides returns the defaults; overrides are a shallow spread over the defaults.

## Edge cases

- Function labels (`listSelected(count)`, `toastNotebookDeleted(name)`) are covered by calling them with fixed probe arguments; a probe that throws is recorded as such.
- Labels built from other label files (`docsLabels` spreads `driveLabels` pieces, `notesLabels` reads `noPeopleOrTeamsFoundCopy`) are snapshotted in their resolved form.
- An intentional copy change later must update the snapshot (`vitest -u` on the one file); the test says so in its header.
