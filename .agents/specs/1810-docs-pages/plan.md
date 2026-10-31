# Docs pages and page break

Derived from [spec.md](./spec.md).

## Goal

Word-processor pages in Docs with a personal paper size, plus a page break that holds on screen, in print, in Markdown and in collaboration, in one PR into `integration/docs-pages`.

## Budget

Draws from the Docs editor bundle (one MIT dependency, about 30 kB unminified) and from layout work on each Docs transaction (one measuring pass per update while pages show). Displaces nothing; Notes builds no pagination.

## Non-goals

See [spec.md](./spec.md#non-goals).

## What exists

- The editor extension list is shared by Docs and Notes; non-plain-text formats add `DocsImage`. `path: packages/apps/src/text-editor-core/src/text-editor-extensions.ts:127`
- Host-specific slash items go through a parameter, not the base list (Image). `path: packages/apps/src/text-editor-core/src/text-editor-slash-menu.tsx`
- The only custom Markdown serializer is `DocsImage`. `path: packages/apps/src/text-editor-core/src/text-editor-image-extension.ts`
- Device-local UI preferences live in `localStorage` under `wgw.ui.*`. `path: packages/apps/src/calendar-core/src/use-calendar-display-prefs.test.tsx:21`
- Phone width is below 768 px. `path: packages/apps/src/hooks/use-mobile.ts:7`
- Print goes through body classes and print CSS, no iframe. `path: packages/apps/src/text-editor-core/src/text-editor-print.ts`
- Helper editors seed and read Docs Yjs content with their own schema. `path: packages/apps/src/text-editor-core/docs-collab/docs-collab-editor-surface.tsx`

## Considered

- Considered: custom page layout code — rejected by the product decision (#1810): use the battle-tested MIT `tiptap-pagination-plus`.
- Considered: forking `tiptap-pagination-plus` for forced breaks and table handling — rejected: everything needed fits in an `extend()` plus two small plugins and CSS; no fork.
- Considered: `tiptap-table-plus` for tables across pages — out of scope (#1810 non-goal); rows-as-boxes CSS covers the runaway.
- Considered: page break node only in the Docs editor — rejected: y-prosemirror deletes unknown nodes in helper editors.
- Considered: storing page setup in the document — rejected by the product decision; personal setting until #1598.
- Considered: a CSS grid per table row — rejected: Chrome does not move a grid row below a page end it overlaps; a `display: table` row moves whole.

## Affected packages

- packages/apps

## Dependencies

1. Page format table and preference store.
2. Page break node and serializer (needed by the fill plugin).
3. Pagination extension and plugins.
4. Docs header menu and wiring.

## Open decisions

None — every choice is made. UI points for the product lead are listed in the PR.

## Invariants

- Markdown without breaks is unchanged by a round trip, and a break round-trips byte-identical. A wrong serializer rewrites every saved Doc. Proof: `path: packages/apps/src/text-editor-core/src/text-editor-page-break.test.ts` assertion `round-trips a page break byte-identical`.
- Notes builds no pagination and offers no page break. A wrong option leaks pages into Notes. Proof: `path: packages/apps/src/text-editor-core/src/text-editor-pagination.test.ts` assertion `adds pagination only when a page setup is passed`; `path: packages/apps/src/text-editor-core/src/text-editor-slash-commands.test.ts`.
- The default paper size follows the locale region. A wrong lookup gives US users A4. Proof: `path: packages/apps/src/lib/page-format.test.ts`.
- A stored preference survives bad JSON and unknown values. Proof: `path: packages/apps/src/lib/docs-page-setup.test.ts`.
- A page break lands on the next page end. Proof: `path: packages/apps/src/text-editor-core/src/text-editor-page-break-fill.test.ts`.

## Chunks

### Chunk A: page format and preference
- **Skill:** apps-ui
- **Inputs:** `path: packages/apps/src/calendar-core/src/use-calendar-display-prefs.test.tsx:21`
- **Done when:** `src/lib/page-format.ts`, `src/lib/docs-page-setup.ts`, `use-docs-page-setup.ts` exist with tests.
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/lib/page-format.test.ts src/lib/docs-page-setup.test.ts`
- **Parallel with:** B

### Chunk B: page break node
- **Skill:** apps-ui
- **Inputs:** `path: packages/apps/src/text-editor-core/src/text-editor-image-extension.ts`
- **Done when:** node, serializer, parse hook, Docs-only slash item, print CSS; round-trip tests.
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/text-editor-core/src/text-editor-page-break.test.ts src/text-editor-core/src/text-editor-slash-commands.test.ts`
- **Parallel with:** A

### Chunk C: pagination
- **Skill:** apps-ui
- **Inputs:** `path: packages/apps/src/text-editor-core/src/text-editor-extensions.ts:127`
- **Done when:** `TextEditorPagination` extension, page-break fill plugin, oversize-row plugin, screen and print CSS; Docs editors pass the page setup; Notes does not.
- **Verify with:** Vitest above plus browser check on a production preview build (every format, orientation, toggle, print page count, Notes, dark).
- **Parallel with:** none (needs A and B)

### Chunk D: Docs header menu
- **Skill:** apps-ui
- **Inputs:** `path: packages/apps/src/docs-core/src/docs-header-actions.tsx`
- **Done when:** page setup menu in the Docs header (collab and fallback workspace).
- **Verify with:** browser check.
- **Parallel with:** none

## Test plan

- [ ] Vitest: page format table and locale default; preference parse/resolve/write; page break Markdown round trip and comment parse; slash item Docs vs Notes; page-end choice for a break; pagination only with a page setup.
- [ ] Browser (production preview): every format and orientation, Continuous toggle, refresh mid-edit, second tab, offline edit then sync, print page count, Markdown round trip, Notes unaffected, light and dark.
