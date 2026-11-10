Source: #1615 (body-hash: 7782374f)
Goal: WeGotWorkspace/Product#107

# Guide Google Docs users in through a Word export

Technical translation of Task [#1615](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/1615). No second importer: a Google Doc enters through *File → Download → Microsoft Word (.docx)* and the Word importer from #1619 / #1983 ([1619-import-word-file](../1619-import-word-file/spec.md), [1983-docx-save-as-markdown](../1983-docx-save-as-markdown/spec.md)).

## Goal

People coming from Google Docs see one line that tells them how to bring a document in, and a Google export converts predictably with the usual import report.

## Non-goals

- Any Google sign-in, Google API, or sync (decided in Product#107).
- Spreadsheets, slides, whole-Drive copies.

## Packages

- `packages/apps` only. No new dependencies.

## Design

| Piece | Where | What |
|-------|-------|------|
| Guidance under the menu item | `docx-import/docx-import-labels.ts` (`importGoogleHint`), `use-import-word-file.tsx` | *Import Word file* shows "From Google Docs: File → Download → Microsoft Word (.docx) first." Offline the offline reason replaces it. The OS file picker itself cannot carry text. |
| Empty state | `docs-labels.ts` (`homeEmpty`) | "No documents yet. Create one, or import a Word file. From Google Docs, choose File → Download → Microsoft Word (.docx) there, then import that file." |
| `.gdoc` link files | (from #1983) | Save as Markdown on a `.gdoc` explains the same export steps. |
| Fixture | `docx-import/__tests__/fixtures/google-export.docx` | Built by `build-docx-fixtures.mjs` in the shape of a Google export (see Constraints). |
| Link underline | `docx-to-markdown.ts` (`tidyMammothHtml`) | Google underlines links directly; an underline inside a link is dropped so links do not carry `<u>`. |

## Mapping rules for Google exports

| Google | Doc |
|--------|-----|
| *Title* | Heading 1 |
| *Subtitle* | Plain paragraph |
| *Heading 1–6* | Heading 1–6 (levels kept, not shifted below the Title) |
| Bulleted and numbered lists, nested | Markdown lists, nesting kept |
| Table | Kept. Google marks no header row, so the table stays in the editor's HTML table form inside the Markdown. |
| Image | Doc attachment (`drive:fn-…`) |
| Link | Markdown link, without Google's direct underline |
| Comment | Dropped from the text, counted in the report |
| Pending suggestion (exported as Word tracked changes) | **Applied**: insertions kept, deletions removed. The report says "tracked changes (accepted in the text)". |
| Arial on every run, text colour | Not kept; the report lists 1 font and the non-black colours (links are 1155CC) |

## Constraints and edge cases

- The committed fixture is **synthetic**: there is no Google account in this environment and the project does not sign in to Google. It follows the structure of Google's export: `Title`/`Subtitle`/`HeadingN` styles, direct `Arial` fonts and `000000` colour on every run, `keepNext`/`spacing` on each paragraph, lists as `Normal` paragraphs with `numPr`, fixed-layout tables without header rows, links with direct colour `1155cc` and underline, `comments.xml`, and suggestions as `w:ins`/`w:del` with the suggester as author. Replace it with a real export when one is at hand (see Decisions).

## Decisions for Wouter

1. **Synthetic Google fixture.** #1615 asks for a fixture made from a real Google Doc. That needs a Google account, which this work does not use. The fixture is built to match Google's export structure and is marked as synthetic in the builder. Dropping a real export in as `google-export.docx` (same content list) should keep the test green; if it does not, the test shows where Google differs.
2. **Suggestions are applied.** mammoth accepts tracked changes, so pending suggestions end up in the text. The report says so. Rejecting them instead would need a custom pass over the XML; not done.
