# Guide Google Docs users in through a Word export

## Goal

The Google route explained in the `.gdoc` dialog only (product decision 2026-11-10: no hint under the menu item), a Google-shaped synthetic export fixture through the Word importer, and documented mapping rules.

## Budget

Pioneer programme import/export night (2026-11-10). Lands on `integration/import-export`, not main. Displaces nothing.

## Non-goals

See [spec.md](./spec.md#non-goals).

## What exists

- Import docx file(s) menu item. `path: packages/apps/src/docs-core/src/docx-import/use-import-word-file.tsx`
- `.gdoc` dialog under Save as Markdown (#1983). `path: packages/apps/src/docs-core/src/docx-import/docx-import-dialogs.tsx`
- Docs home empty state text. `path: packages/apps/src/docs-core/src/docs-labels.ts:14`
- Style map (Title → h1, Subtitle → p). `path: packages/apps/src/docs-core/src/docx-import/docx-to-markdown.ts`
- Fixture builder. `path: packages/apps/src/docs-core/src/docx-import/__tests__/fixtures/build-docx-fixtures.mjs`

## Considered

- A Google sign-in or Drive API import: ruled out by Product#107.
- Putting the hint in the import dialog: rejected; the dialog opens after the file is picked, too late to help.
- A hint under the menu item and in the empty state: built first, then dropped by product decision 2026-11-10. The menu item stays one plain line.
- Shifting heading levels down under a Title: rejected; Word files keep their levels, and Google exports should behave the same.

## Affected packages

- packages/apps

## Dependencies

1. #1619 (PR #1993) lands first; this branch is stacked on it.

## Open decisions

None — see "Decisions for Wouter" in [spec.md](./spec.md#decisions-for-wouter).

## Invariants

- Google suggestions are applied and reported as accepted; comments are reported, not merged. Proof: `path: packages/apps/src/docs-core/src/docx-import/google-docs-export.test.ts` "applies pending suggestions, and the report says so; comments are reported, not merged".
- Title becomes heading 1 and Subtitle a plain paragraph. Proof: `path: packages/apps/src/docs-core/src/docx-import/google-docs-export.test.ts` "maps Title to heading 1 and Subtitle to a plain paragraph".
- The *Import docx file(s)* item has no subtitle, and the empty state names no Google steps (product decision 2026-11-10). Proof: `path: packages/apps/src/docs-core/src/docx-import/use-import-word-file.test.tsx` "offers Import docx file(s) without a subtitle, and nothing when disabled"; `path: packages/apps/src/docs-core/src/docs-labels.test.ts` "keeps Docs-specific home and rename dialog copy".
- The synthetic `google-export.docx` is the Google export test; no real export is required. Proof: `path: packages/apps/src/docs-core/src/docx-import/google-docs-export.test.ts`.

## Chunks

### Chunk A: guidance and fixture
- **Skill:** workspace, testing
- **Inputs:** Word importer — `path: packages/apps/src/docs-core/src/docx-import/save-docx-as-markdown.ts`
- **Done when:** no hint under the menu item or in the empty state (the `.gdoc` dialog explains the route); synthetic fixture test green.
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/docs-core`
- **Parallel with:** none
