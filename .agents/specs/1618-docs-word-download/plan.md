# Download a Doc as a Word file

Derived from [spec.md](./spec.md). One builder, sequential chunks, one PR into `integration/import-export`.

## Goal

See [spec.md](./spec.md#goal): a *Download → Word (.docx)* action in the Doc header that builds the file in the browser.

## Budget

Draws from the Pioneer programme (wave 4, #1616–#1618). Displaces nothing; #1617 (PDF) adds its item to the same menu afterwards.

## Non-goals

See [spec.md](./spec.md#non-goals).

## What exists

- Doc header actions are a list of `DocsHeaderAction` rendered as icon buttons on wide screens and as entries in a "More actions" dropdown on narrow ones. `path: packages/apps/src/docs-core/src/docs-header-actions.tsx:79`
- The page setup control is already a dropdown in the row and a submenu in the overflow menu; the Download menu follows the same pattern. `path: packages/apps/src/docs-core/src/docs-header-actions.tsx:40`
- Two headers build the action list: the collab workspace (`docsCollabHeaderActions`) and the legacy single-editor workspace. `path: packages/apps/src/text-editor-core/docs-collab/docs-collab-header-actions.tsx:30`, `path: packages/apps/src/docs-core/src/docs-workspace.tsx:272`
- The editor schema: StarterKit, Underline, Link, Highlight, TaskList/TaskItem, TextAlign (heading, paragraph), Table, CommentMark, CommentDraftAnchor, LegacySuggestionMark, DocsImage, PageBreak. `path: packages/apps/src/text-editor-core/src/text-editor-extensions.ts:106`
- Live suggestions are `insertion`, `deletion` and `formatChange` marks from `tiptap-track-changes`. `path: packages/apps/src/text-editor-core/src/text-editor-track-changes-marks.ts:61`
- The image extension carries its fetcher as the `fetchContent` option; the node view shows the fetched blob as an object URL. `path: packages/apps/src/text-editor-core/src/text-editor-image-extension.ts:81`, `path: packages/apps/src/text-editor-core/src/text-editor-image-node-view.ts:245`
- Page setup per Doc and the locale default. `path: packages/apps/src/lib/page-format.ts:118`
- Blob download helper. `path: packages/apps/src/lib/offline/docs/docs-offline-download.ts:35`

## Considered

- `prosemirror-docx` 0.6.1 — rejected in the spike: empty body without `sections`, image part named after the `drive:fn-…` src (LibreOffice refuses the file), no Tiptap header rows or task lists, package entry broken outside a bundler.
- Building from the stored Markdown — rejected: alignment is not stored in the Markdown.
- One walker straight to `docx` objects (the spike) — split into walker + writer so #1617 and a later OpenDocument writer share the cleanup rules (comments, suggestions) and the tests for them.
- Server-side generation (PhpWord) — rejected: offline must work, and the content is live Yjs state in the browser.
- Pending suggestions shown as Word tracked changes — out of scope (issue non-goal); exported as accepted.

## Affected packages

- packages/apps

## Dependencies

1. Walker (chunk A) before the writer (chunk B).
2. Writer before the menu wiring (chunk C).

## Open decisions

None — every choice is made. Choices that Wouter may want to revisit are listed in the PR under "Decisions for Wouter" (suggestions exported as accepted; external images as linked placeholders; menu placement).

## Invariants

- Comment marks and suggestion markup never reach the file. Proof: `path: packages/apps/src/text-editor-core/src/export/text-editor-export-blocks.test.ts`.
- `docx` is not in the Docs route's static import graph. Proof: the writer is only reached through `import()` in `docs-download-word.ts`; `cmd: pnpm --dir packages/apps build` chunk list.
- Print still works and keeps its place in the header. Proof: `path: packages/apps/src/docs-core/src/docs-header-actions.test.tsx`.

## Chunks

### Chunk A: Export walker

- **id:** `chunk-a-walker`
- **Skill:** workspace
- **Inputs:** editor schema (see What exists)
- **Done when:** `editorJsonToExportBlocks()` maps every node and mark the schema has, drops comment and suggestion markup, and is covered by Vitest built on a real editor's `getJSON()`.
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/text-editor-core/src/export`
- **Parallel with:** none

### Chunk B: Word writer and image collection

- **id:** `chunk-b-docx-writer`
- **Skill:** workspace
- **Inputs:** chunk A types; `docx` 9.x
- **Done when:** the writer produces a `.docx` whose `word/document.xml`, `styles.xml`, `numbering.xml` and relationships match the spec (Vitest unzips with `fflate` and reads the XML); images are collected through the editor fetcher with the DOM blob fallback.
- **Verify with:** same Vitest command
- **Parallel with:** none

### Chunk C: Download menu

- **id:** `chunk-c-download-menu`
- **Skill:** apps-ui, workspace
- **Inputs:** `DocsHeaderActions`, both header builders
- **Done when:** both headers show *Download → Word (.docx)* (a dropdown in the wide row, a submenu in the narrow menu), disabled in source view and while busy; the download names the file after the Doc.
- **Verify with:** Vitest (RTL) + own browser e2e on the dev stack
- **Parallel with:** none

## Test plan

- [ ] Vitest: walker on a fixture Doc with every construct.
- [ ] Vitest: writer output read back from the zip (heading styles + outline levels, numbering instances, table header row, image relationship and media part, hyperlink relationship, page size).
- [ ] Vitest: header menu entries and disabled states.
- [ ] Browser e2e: a Doc with headings, lists, a table, a `drive:fn-…` image and a link → download → unzip → check `document.xml`; open with LibreOffice headless (`--convert-to pdf`) and check the text with `pdftotext`.
