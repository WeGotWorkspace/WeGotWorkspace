# Save a Word file as a Markdown Doc

## Goal

Turn a `.docx` in Drive into a new `.md` Doc next to it, from the row menu in Drive and in the Docs file list, with an import report. Reuse #1619's converter design so #1619 and #1615 only add entry points and fixtures later.

## Budget

Pioneer programme import/export night (2026-11-10). Lands on `integration/import-export`, not main. Displaces nothing.

## Non-goals

See [spec.md](./spec.md#non-goals).

## What exists

- No import path and no `.docx` library on main. `path: packages/apps/package.json`
- Image attachments need the Doc to exist first. `path: packages/apps/src/text-editor-core/docs-collab/docs-image-upload.ts:90`
- `drive:fn-` is the only stored image source; `data:` and `blob:` are dropped on serialize. `path: packages/apps/src/text-editor-core/src/text-editor-image-src.ts:34`
- Collision-safe create, keep-both naming. `path: packages/apps/src/lib/api/wgw/drive-create-keep-both.ts:28`
- Drive per-row extra actions. `path: packages/apps/src/drive-core/src/drive-workspace.tsx:158`
- Docs home reuses Drive's grid and list views (same row menu). `path: packages/apps/src/docs-core/src/docs-home-pane.tsx:296`
- Docs home filters by extension; `.docx` is in category `document`, `.gdoc` in `file`. `path: packages/api/app/Services/Search/SearchIndexerService.php:441`
- Server Doc limit 2,097,152 bytes. `path: packages/api/app/Services/Collab/DocCollabDocumentService.php:27`
- Headless editor pattern with an image fetch that never runs. `path: packages/apps/src/text-editor-core/src/text-editor-track-changes.ts:241`
- Converter design, refusal rules and report contents come from [#1619](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/1619); the spike behind them (mammoth vs alternatives, style map, scan, timings, license gate) is on the unmerged branch `spike/docs-import-export`, in `.agents/specs/docs-import-export-spike/findings.md`.

## Considered

- `@docen/import-docx` and `odf-kit`'s docx reader (no jszip, so no license change): rejected in the spike. Flattened lists, lost images and tracked text, no report data.
- A PHP reader on the server: rejected in #1619 (memory on small hosts, weaker formatting).
- Allowing the bare "BSD" identifier in the license policy: rejected in favour of a per-package override that only applies while `duck` declares "BSD".
- Showing the report as a toast or before opening the Doc: rejected; #1619 asks for it when the Doc opens, and a toast is too short for a list.
- Converting on double-click of a `.docx` row in Docs: rejected; opening should not create files. Double-click points to the menu action.
- Rewriting image sources in the editor after upload: rejected; a second `getMarkdown()` doubles the slowest step. Placeholders with the same length as real ids are swapped in the Markdown string.
- A Worker: the editor needs a DOM. Deferred until the serializer is faster (spike side finding 2).

## Affected packages

- packages/apps
- tools (license policy)

## Dependencies

1. Converter + scan + report (chunk A) before the entry points (chunk B).
2. Chunk B's Docs list change needs no API change.

## Open decisions

None — every choice is made; the cautious ones are listed under "Decisions for Wouter" in [spec.md](./spec.md#decisions-for-wouter).

## Invariants

- Nothing is written before every refusal check passed. Proof: `path: packages/apps/src/docs-core/src/docx-import/save-docx-as-markdown.test.ts` "refuses %s and writes nothing".
- Write order is create → upload images → write once. Proof: `path: packages/apps/src/docs-core/src/docx-import/save-docx-as-markdown.test.ts` "creates, uploads images, then writes the Markdown once".
- Offline body sync still syncs only md/markdown/txt, and offline cache updates (new, renamed, trashed Docs) write to the same cache key as the live list. Proof: `path: packages/apps/src/lib/offline/docs-listing-offline-store.test.ts` "upserts an offline-created document into all-docs and drive-scoped caches".
- Word rows never show the "syncing offline" badge. Proof: `path: packages/apps/src/docs-core/src/docs-home-workspace-model.test.ts` "never marks Word files or Google links, which do not sync offline (#1983)".
- The converter is not in the Docs or Drive entry chunks. Proof: `cmd: pnpm --dir packages/apps build` and the `docx-to-markdown` chunk in the output.

## Chunks

### Chunk A: converter
- **Skill:** workspace, testing, security (caller-supplied file parser)
- **Inputs:** spike scan and style map — `path: .agents/specs/docs-import-export-spike/findings.md` on `spike/docs-import-export`
- **Done when:** fixtures convert as the issue lists; refusals and write order tested.
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/docs-core/src/docx-import`
- **Parallel with:** none

### Chunk B: entry points and report dialog
- **Skill:** workspace, apps-ui
- **Inputs:** extra row actions — `path: packages/apps/src/drive-core/src/drive-workspace.tsx:158`
- **Done when:** action in Drive and Docs rows; report dialog in the opened Doc; offline reason; `.gdoc` explanation.
- **Verify with:** jsdom tests + own browser e2e (Drive, Docs list, corrupt file, refresh).
- **Parallel with:** none
