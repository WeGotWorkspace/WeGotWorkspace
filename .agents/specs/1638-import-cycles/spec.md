Source: #1638 (body-hash: fa0554f5)

# Break the import cycles between app packages

Technical translation of Chore #1638. The issue holds the acceptance criteria. The allowed directions are the ones #1632 encodes ([spec](../1632-import-boundaries/spec.md), [import-boundaries.md](../../skills/apps-ui/import-boundaries.md)); this series moves code until `pnpm --filter @wgw/apps run lint:boundaries` reports fewer warnings with every pull request.

## Goal

Shared code that lives in an app package moves down into `src/lib/`: first the Drive file model and path helpers (`src/lib/files/`), then the sharing model that the domain types depend on, then the domain types (`src/lib/models/`), then the meeting-link helpers (`src/lib/meetings/`). Each move is a rename plus import updates, with no behavior change.

## Non-goals

- Behavior or UI changes. A move that would need one stops and is listed for the product lead.
- `error` level for the rule (the #1642 follow-up, once the count allows).
- The moves the issue does not name (settings footer, text-editor → Docs labels, Tasks ↔ Calendar alarms) unless the named moves are done first.

## Affected packages

- `packages/apps/src`: `drive-core`, `docs-core`, `share-ui`, `*-core` type modules, `lib/files`, `lib/models`, `lib/sharing`, `lib/meetings`, and their importers.

## Settled decisions

- **No re-export shims.** Every importer is updated in the same pull request and the old file is deleted. A shim at the old path would keep the warning and leave two homes for one type. Exception: a package's public `index.ts` may re-export a moved type, since an app re-exporting `lib` is a downward import.
- **File names stay.** `drive-types.ts` keeps its name under `lib/files/`, so a reviewer sees a rename (`git mv`, similarity 100%) and the blame survives.
- **One move per pull request**, stacked on the previous one, each recording the `lint:boundaries` count before and after.
- **Mixed modules are split, not moved whole.** `drive-file-utils.ts` uses Drive's labels and `drive-batch-utils.ts` uses React state setters; only their pure helpers move.

## Edge cases

- `vi.mock("@/drive-core/src/…")` strings in tests are import paths too; the rewrite covers them, and the jsdom suite proves it.
- Old spec folders cite old paths as history; they are not rewritten.
