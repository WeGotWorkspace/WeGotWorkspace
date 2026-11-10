Source: #1619 (body-hash: 43b04784)
Goal: WeGotWorkspace/Product#105

# Import a Word file as a new Doc

Technical translation of Task [#1619](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/1619). The converter, scan, import report, image handling and refusals were built for #1983 (spec: [1983-docx-save-as-markdown](../1983-docx-save-as-markdown/spec.md)). This spec only adds the entry point on Docs home.

## Goal

Docs home gets *Import Word file* next to *New document*. The person picks a `.docx` on their device, names the Doc and picks its folder in the same dialog as *New document*, and the new Doc opens with the import report.

## Non-goals

- Everything listed as a non-goal in #1619 (Google guidance, export, `.odt`, several files at once).
- Keeping text alignment: a Doc's Markdown cannot store it (`tiptap-markdown` writes paragraphs and headings without attributes). Alignment is listed in the report until Docs stores it.
- Drag and drop of `.docx` onto the Docs list.

## Packages

- `packages/apps` only. No new dependencies.

## Design

| Piece | Where | What |
|-------|-------|------|
| Split button | `docs-core/src/docs-home-sidebar.tsx` | `SidebarSegmentedNewMenu` (the Calendar/Notes pattern) when there are extra items; a plain *New document* button otherwise. |
| Menu item + picker | `docs-core/src/docx-import/use-import-word-file.tsx` | *Import Word file* item (disabled offline with the same reason as Save as Markdown, hidden for guests) and a hidden `<input type="file" accept=".docx,…">`. |
| Name and folder | `docs-core/src/use-docs-home-create-dialog.ts` | Import mode of the New document dialog: default name is the Word file's base name plus `.md`, made free with the same logic (`Plan.md`, `Plan 2.md`, …); title, description and button say *Import*. Closing forgets the file. |
| Flow | `docs-core/src/docx-import/save-docx-as-markdown.ts` | `importDocxFile(file, docPath)`: refuses files above 50 MiB before reading, then the shared `convertDocxIntoNewDoc` (scan → convert → 2 MiB check → create → images → write once → remove on failure). Save as Markdown uses the same core. |
| Toast + report + open | `docs-core/src/docx-import/use-docx-conversion-runner.ts` | Shared with Save as Markdown: one run at a time, progress toast, report hand-over, page setup, open the Doc; refusals explained in an error toast. |
| Story | `docs-core/stories/docx-import-report.stories.tsx` | The report dialog in light and dark. |

`markdownNameFor` moved to `docx-file-name.ts` so the dialog hook does not pull the converter into the Docs bundle.

## Constraints and edge cases

- The chosen name can be taken by the time the Doc is created (another tab). The create step keeps both, so the Doc then gets `Name (1).md`.
- Picking the same file twice in a row works (the input is cleared after each pick).
- The picker filters on `.docx`, but people can still choose other files; the scan refuses them with the same messages as Save as Markdown (old `.doc` gets its own hint).
- Offline: *New document* still works (queued offline); *Import Word file* is disabled with a reason.

## Decisions for Wouter

1. **Alignment is reported, not kept.** #1619 lists alignment among what should come across. A Doc's Markdown has no way to store it, so it stays in the report until Docs can store alignment.
2. **The Word file is not uploaded to Drive.** Only the new Doc (and its images) are saved, like *New document*.
