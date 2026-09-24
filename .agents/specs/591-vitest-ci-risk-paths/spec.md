Source: #591 (body-hash: c3c5bfdc)

# vitest-ci plays on risk paths

Technical translation of Task #591. Parent quality bar: #584. Not a product feature.

## Goal

Gate one Storybook `play` for the Drive public-link toggle and one for Drive/Docs trash confirm. Calendar RSVP stays on the existing CI jsdom click tests.

## Non-goals

- Mail compose
- Guest public-link session (#847)
- Team or role grant plays
- API or OpenAPI changes

## Affected packages

- packages/apps

## Technical constraints

- New `vitest-ci` stories must stay clean when `STORYBOOK_A11Y_GATE=1`. That flag is set by `packages/apps/scripts/done-gate.mjs`, which CI `apps-quality` runs. `pnpm test:storybook:ci` alone does not set it.
- RSVP jsdom (`calendar-rsvp-actions.test.tsx`, `calendar-invitations-panel.test.tsx`) runs only when `APPS_DONE_GATE_FULL=1` (CI). The local done gate skips jsdom.
- Share story state is one `useState` lazy store per story instance. Do not hoist `atPath` to module scope.
- Trash plays spy `renameItem` (the call `confirmTrash` and `moveToTrash` make after `ensureTrashFolder` and `listTrashEntryNames`). Assert `from` and `destination` together inside `waitFor`. `destination` is `apiPathFromUiPath(DRIVE_TRASH_UI_PATH, username, groupRoots)`, the same derivation those functions use. `from` comes from the harness or story fixture, not a hardcoded path string.
- Stub `listAllDirectoryEntries` so `.Trash` already exists. Do not add a `createFolder` mock for that path.
- Drive Cancel is a sibling story.

## Edge cases

- The public-link section title is visible while access is off. The play asserts the switch `aria-checked` and the copy control after refetch.
- Docs row hide is optimistic. The play does not treat a missing row as proof of the mutation.
- Docs trash stories must not pass `offlineUsername`, so the play does not open Dexie.
