Source: #1810 (body-hash: 11052c9c)
Also implements: #1616 (body-hash: f891edad)
Goal: WeGotWorkspace/Product#124, WeGotWorkspace/Product#125

# Docs pages and page break

Technical translation of Task #1810 (pages on screen with a personal paper size) and Task #1616 (page break). Both ship together on `integration/docs-pages`.

## Goal

Docs shows a document as separate pages on screen, sized to the paper the person picked (A4, A3, A5, Letter, Legal; portrait or landscape), with fixed 1 inch margins. A Continuous option keeps the old single sheet. The choice is a device-local preference, never written into the document. A `pageBreak` block node, stored as `<!-- pagebreak -->`, starts the following content on a new page on screen and in print. Print follows the chosen paper size through `@page`.

## Non-goals

- Page setup stored in the document (Epic #1592, storage choice #1598).
- Custom margins, headers, footers, page numbers.
- `tiptap-table-plus` / `tiptap-image-plus` in place of our table and image code.
- PDF and Word download (#1617, #1618), import.
- Pages on phone-width screens.

## Affected packages

- packages/apps (text-editor-core, docs-core, lib)

## Technical constraints

- **Pages are decorations only.** `tiptap-pagination-plus` 3.1.0 (MIT) draws page ends as floated widgets at position 0. The document, Markdown, Yjs and undo never see pages.
- **Docs only.** The pagination extension is added only when the Docs editor passes a page setup. Notes never passes one.
- **Schema everywhere, insert in Docs only.** The `pageBreak` node is in the shared schema of every non-plain-text editor, the same as `DocsImage`. y-prosemirror drops nodes a schema does not know, and helper editors (seed, read-back, offline merge) build their own schema; a Docs-only node would be lost by them. Only the Docs slash menu offers *Page break*. This reads #1616's "enabled for Docs only" as "insertable in Docs only".
- **Markdown form.** `<!-- pagebreak -->` on its own line, written by a custom serializer. Parsing turns any `pagebreak` HTML comment into the node before ProseMirror reads the HTML, so a comment without blank lines around it (from another editor) still parses.
- **Preference store.** `localStorage` key `wgw.ui.docs.pageSetup`, the same device pattern as `wgw.ui.calendar.displayPrefs`. Open editors in the same tab follow a change event; other tabs follow the `storage` event.
- **Default.** Pages on, portrait, Letter for a US or CA locale region, A4 otherwise.
- **Print.** Screen-only page chrome; print lays out its own pages with `@page { size: <format> <orientation>; margin: 1in }`, mounted while a Docs editor is mounted. The page break prints nothing and has `break-after: page`.

## Edge cases

- A block that keeps its own layout (table, code block, image) cannot flow past a floated page end; the browser moves it below all floats, and the library then adds pages forever. With pages on: each table row is its own box, a row taller than a page stacks its cells, code blocks wrap, images are capped at one page of content.
- Two page breaks in a row leave one empty page.
- A paper size change in a live editor: the library's measured page heights are stale and its count lags one pass; both are corrected without an edit.
- View-source split and phone widths show the continuous sheet; the page setup menu hides on phones with the other header actions.
- The library's own editor-view access before mount or after unmount must not throw.
