# Import a Word file as a new Doc

## Goal

Add *Import Word file* to Docs home on top of the #1983 converter, with the New document dialog for name and folder.

## Budget

Pioneer programme import/export night (2026-11-10). Lands on `integration/import-export`, not main. Displaces nothing.

## Non-goals

See [spec.md](./spec.md#non-goals).

## What exists

- Converter, report and refusals from #1983. `path: packages/apps/src/docs-core/src/docx-import/save-docx-as-markdown.ts`
- New document dialog with free-name logic. `path: packages/apps/src/docs-core/src/use-docs-home-create-dialog.ts:33`
- Split New button used by Calendar, Notes, Tasks and Contacts. `path: packages/apps/src/sidebar-segmented-new-menu/src/sidebar-segmented-new-menu.tsx`
- Docs home sidebar with a plain New document button. `path: packages/apps/src/docs-core/src/docs-home-sidebar.tsx`

## Considered

- A second sidebar button: rejected; #1619 points to the new-menu pattern.
- Uploading the `.docx` to Drive first and reusing Save as Markdown: rejected; it leaves a Word file the person did not ask for.
- A separate import dialog: rejected; #1619 asks for the same name-and-location dialog.

## Affected packages

- packages/apps

## Dependencies

1. #1983 (PR #1990) lands first; this branch is stacked on it.

## Open decisions

None — see "Decisions for Wouter" in [spec.md](./spec.md#decisions-for-wouter).

## Invariants

- A picked file is refused before reading when too large, and nothing is written for any refusal. Proof: `path: packages/apps/src/docs-core/src/docx-import/save-docx-as-markdown.test.ts` "refuses a huge file before reading it".
- Closing the import dialog forgets the Word file, so New document stays a plain new Doc. Proof: `path: packages/apps/src/docs-core/src/use-docs-home-create-dialog.test.tsx` "forgets the Word file when the import dialog is closed".
- Import is disabled offline with a reason. Proof: `path: packages/apps/src/docs-core/src/docx-import/use-import-word-file.test.tsx` "is disabled with a reason while offline".

## Chunks

### Chunk A: entry point
- **Skill:** workspace, apps-ui
- **Inputs:** converter — `path: packages/apps/src/docs-core/src/docx-import/save-docx-as-markdown.ts`
- **Done when:** split button, picker, dialog import mode, story; own browser e2e.
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/docs-core`
- **Parallel with:** none
