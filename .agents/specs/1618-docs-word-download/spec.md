Source: #1618 (body-hash: f4029a90)
Goal: WeGotWorkspace/Product#108

# Download a Doc as a Word file

Technical translation of Task [#1618](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/1618). Prior research: the import/export spike (branch `spike/docs-import-export`, never merged), whose findings chose our own walker on `docx` over `prosemirror-docx`.

## Goal

An open Doc gets a *Download* menu in its header with *Word (.docx)*. The browser builds the file from the live editor content (`editor.getJSON()`, not the stored Markdown, because text alignment only lives in the live document) and saves it as `<Doc name>.docx`. No server work.

The work is two layers in `packages/apps/src/text-editor-core/src/export/`:

1. **Walker** (`text-editor-export-blocks.ts`): editor JSON → neutral export blocks. It removes what Print does not show as markup (comment marks, comment draft anchors, legacy suggestion marks, format-change marks) and resolves pending suggestions. No `docx` import, so later writers (PDF, OpenDocument) can reuse it.
2. **Word writer** (`docs-docx-writer.ts`): export blocks → `docx` `Document` → `Blob`. Loaded with a dynamic `import()` only when the person picks the action, so the `docx` library stays out of the Docs chunk.

An orchestrator (`docs-download-word.ts`) collects the images, loads the writer, names the file and calls `triggerBrowserBlobDownload`.

## Non-goals

- Opening a Word file as a Doc (#1619), OpenDocument download
- Comments or tracked changes in the Word file
- Headers, footers, page numbers, per-Doc margins (Epic #1592)
- Pixel-perfect round-trip; fonts beyond a default body font and a monospace font
- External (`https://`) images inside the file (see edge cases)

## Affected packages

- `packages/apps` only. New dependency: `docx` 9.x (MIT; deps `fflate`, `nanoid`, both MIT).

## Technical constraints

- **Lazy load:** `docx` is only imported inside the writer module, and the writer is only reached through `import()`. The Docs route chunk must not grow by the library.
- **Styles Word understands:** headings use Word's built-in `Heading1`–`Heading6` style ids with an explicit `outlineLevel` (0–5), so the navigation pane and table of contents work. Lists use real `w:numPr` numbering (one bullet and one ordered abstract numbering; each top-level ordered list gets its own instance so it restarts at its own start number). Named styles for round trip with the importer (#1619): paragraph `Code`, `Quote`, `Divider`; character `InlineCode`, `Hyperlink`.
- **Task lists:** `☒` / `☐` plus a tab and the text, indented per level. Not Word content controls.
- **Tables:** column widths split evenly over the text column; `colspan`/`rowspan` kept; `tableHeader` only on a row whose cells are all header cells (mammoth reads `w:val="off"` as a header too); rows do not split across pages. An empty paragraph follows each table so two tables never merge.
- **Images:** for each `drive:fn-…` source the blob the node view already shows is reused first (same bytes, no network, so it works offline). Only when the editor shows none is the image fetched through the editor's own `DocsImageContentFetcher` (the image extension's `fetchContent` option), with a 20 s timeout, because a fetch can hang instead of failing while offline. Size = natural pixel size capped to the text column width, the same as `max-width: 100%` on screen. PNG, JPEG, GIF and BMP go in as-is; any other type (WebP, AVIF, SVG) is drawn to a canvas and embedded as PNG.
- **Page:** size and orientation follow the Doc's page setup (`useDocsPageSetup`); paper *None* falls back to `defaultTextEditorPageFormat(navigator.languages)` (A4, Letter for US/CA). Margins: the fixed 1 inch the editor and print use.
- **File name:** the Doc's title with its `.md`/`.markdown`/`.txt`/`.html` extension replaced by `.docx`.
- **Busy state:** the menu item is disabled while a download runs; a failure shows an error toast. Images that could not be included become an italic `[Image: alt]` placeholder and a warning toast says how many.

## Edge cases

- Pending suggestions: exported **as if accepted** — insertion text kept, deletion text dropped, format-change marks ignored (the format is already applied). Decision for Wouter, recorded in the PR.
- Comment marks and draft anchors: text kept, mark dropped.
- Empty Doc: a valid file with one empty paragraph.
- Text format Docs (`.txt`): the editor has no image or page-break nodes; the walker still works on paragraphs.
- External `https://` images: not fetched (privacy: the editor only loads them after a per-host opt-in, and CORS usually blocks reading the bytes). They become a placeholder linked to the URL.
- A list item with several paragraphs or a nested block: the first paragraph carries the number, later blocks are indented to the item text.
- Hard breaks inside a paragraph: a Word line break (`w:br`), not a new paragraph.
- Code block: one `Code` paragraph per block with line breaks, so it reads as one block.
- Page break nodes (#1616): `w:br w:type="page"`.
- Source view open: the Download menu is disabled, the same as Print, so a half-typed source edit is never exported.
