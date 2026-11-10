Source: #1983 (body-hash: adf08c1b)
Goal: WeGotWorkspace/Product#105

# Save a Word file as a Markdown Doc

Technical translation of Task [#1983](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/1983). The converter, import report, image handling and refusal rules come from #1619 and the import/export spike (`spike/docs-import-export`, findings in its `.agents/specs/docs-import-export-spike/findings.md`). Only the entry point differs: a row action on a `.docx` in Drive and in the Docs file list, instead of a file picker on Docs home.

## Goal

A `.docx` already in Drive can be turned into a new `.md` Doc next to it, in the browser, with a report of what did not come across. Lossy is fine. The server is unchanged.

## Non-goals

- *Import Word file* on Docs home (#1619) and the Google Docs guidance plus a real Google export fixture (#1615). Both reuse this converter later.
- Converting `.gdoc`: the file is a JSON link (`doc_id`, account, sometimes a URL) with no text, and Product#107 rules out a Google sign-in.
- `.doc`, `.odt`, merged cells or lists in cells (#1598), syncing Word file and Doc, batch conversion.
- Running the converter in a Worker. The headless editor needs a DOM, and the slow part is `tiptap-markdown` (see Constraints).

## Packages

- `packages/apps` only. New dependencies: `mammoth` 1.13.0 (BSD-2-Clause) and `fflate` ^0.8 (MIT).
- `tools/license-policy.json` + `tools/check-licenses.mjs`: mammoth pulls in `jszip` "(MIT OR GPL-3.0-or-later)", `pako` "(MIT AND Zlib)" and `duck` "BSD" (BSD-2-Clause text). The policy gets the two exact compound expressions and a per-package override for `duck` that only applies while its declared value stays "BSD".

## Design

### Converter (`packages/apps/src/docs-core/src/docx-import/`)

| File | Role |
|------|------|
| `docx-scan.ts` | Magic-byte and zip checks (refusals), then counts of what is dropped. Only the XML parts it reads are inflated (fflate `unzipSync` filter). |
| `docx-to-markdown.ts` | mammoth → `tidyMammothHtml` → headless editor (`createTextEditorExtensions({ format: "markdown" })`, image fetch that never runs) → Markdown. Images become `drive:fn-0000…<n>` placeholders. |
| `docx-import-report.ts` | Report lines from scan counts plus conversion facts (alignment, failed images). |
| `save-docx-as-markdown.ts` | The flow, with its I/O injected so the order is unit-tested. |
| `docx-import-drive-io.ts` | The real I/O on Drive's JMAP helpers. |
| `load-docx-converter.ts` | The only `import()` of the heavy modules. |

Style map (from the spike, all verified): Title → `h1`, Subtitle → `p`, Quote / Intense Quote → `blockquote`, Code → `pre`, Inline Code → `code`, underline → `u`, highlight → `mark`, page break → Docs page-break node. HTML fix-ups: footnote and endnote references become plain `[n]` text and mammoth's trailing note list becomes a "Notes" section without back-links.

### Flow and write order

1. Refuse `.gdoc` (explanation dialog, nothing read or written).
2. Read the source bytes (`downloadFileNodeBlob`). Over 50 MiB → refuse.
3. `scanDocx` → refuse `ole-container` (old `.doc`, password-protected), `not-a-zip`, `corrupt-zip`, `not-a-docx`.
4. Convert. mammoth throwing → refuse `unreadable`.
5. Markdown over 2,097,152 UTF-8 bytes (the server's `MAX_MARKDOWN_BYTES`) → refuse `too-large`. The placeholders have the final id length, so the check is exact.
6. Create the empty `.md` with `createDriveFileKeepingBoth` in the source's folder: `<base>.md`, else `<base> (1).md`, never replacing a file.
7. Upload each image with `uploadDocAttachmentImage`. A failed upload drops that image and is counted in the report.
8. Swap placeholders for real ids in the Markdown string and write it once onto the new node (`uploadJmapBlob` + `FileNode/set` update by id).
9. If step 7 cannot start or step 8 fails, destroy the new `.md` (best effort) and show the error. Nothing is left behind except possibly orphaned attachments.
10. Default page setup for the new Doc, hand the report to the Doc, open it.

### Report

Lines with counts, in this order: comments; tracked changes ("accepted"); headers and footers; footnotes and endnotes ("kept as Notes at the end"); text boxes whose text is lost; text boxes whose text is kept without the box; text alignment; page breaks before paragraphs; extra sections and page setup; fonts; colours; embedded objects, charts and equations; images that could not be added. Zero counts are left out. An empty report shows nothing.

The report travels from the list to the opened Doc through a small in-memory store keyed by the Doc's API path (`docx-import-report-store.ts`). `docs-app.tsx` takes it once and shows a dialog (Markdown Docs open in the collaborative editor branch there, not in `DocsWorkspace`). A refresh does not show it again.

### Entry points

- Drive: `drive-workspace.tsx` adds the action through `extraFileActions` for `.docx` and `.gdoc` rows, behind the same gate as *New Doc* (structure and upload allowed, `onOpenDocsFile` wired) and never for guests.
- Docs home: the browse query asks for `md`, `markdown`, `txt`, `docx`, `gdoc` (`DOCS_HOME_LIST_EXTENSIONS`) in categories `document` and `file` (the search index files `.gdoc` under `file`, `SearchIndexerService::categoryForExtension`). Offline body sync keeps `DOCS_HOME_EXTENSIONS` (and skips other extensions anyway). The listing cache key and the offline cache updates use the list constants, so they match the live query; cached listings from before this change miss once and reload. `.docx` rows are left out of the "syncing" badge, and opening one shows a toast pointing at *Save as Markdown*. The same row action is passed to `DocsHomePane` as `extraFileActions`. Shared, Starred and Trash views use the same list; Trash offers no action.
- Offline: the item stays visible but disabled, with the reason as its description.

## Constraints and edge cases

- Main-thread cost: a 2 MiB-Markdown file took ~27 s in the spike, almost all in `getMarkdown()`. The action shows a progress toast. Refusing on input size alone is not reliable, so step 5 is the real limit.
- `tiptap-markdown` cannot store text alignment (spike side finding 1). Alignment is reported, not kept.
- mammoth keeps tracked insertions and drops deletions (changes accepted). Comments, headers and footers are dropped. Word and LibreOffice save a text box twice in `mc:AlternateContent` (a modern `mc:Choice` and an older `mc:Fallback`); mammoth reads only the fallback, so the text comes across as plain paragraphs when a fallback copy exists and is lost when it does not. The scan skips fallback copies so every shape is counted once (`docx-alternate-content.ts`).
- mammoth's node build reads `buffer`, its browser build `arrayBuffer`; the converter passes both.
- The new Doc has no Yjs sidecar yet, so the first open seeds it from the written Markdown.

## Decisions for Wouter

1. `.gdoc` shows the action but only explains how to export from Google Docs. Nothing is created.
2. License policy: two exact compound expressions and a per-package override for `duck`, instead of allowing the bare "BSD" identifier.
3. Docs file list now lists `.docx` and `.gdoc` files, so the action is reachable there. Opening such a row does not convert; it points to the menu action.
4. Report shown as a dialog when the Doc opens (not a toast), once per conversion.
