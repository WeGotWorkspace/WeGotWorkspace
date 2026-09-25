# vitest-ci plays on risk paths

Derived from [spec.md](./spec.md).

## Goal

Add gated Storybook plays for enabling a Drive public link and confirming Drive and Docs trash moves.

## Non-goals

- Mail compose, guest share session, team grants, API changes

## Affected packages

- packages/apps

## Dependencies

- Chunk A and chunk B touch different story files and can run together.
- Verify after both.

## Chunks

### Chunk A: Drive share play

- **id:** `chunk-a-share-play`
- **Skill:** storybook
- **Inputs:** `share-dialog.stories.tsx`, `share-dialog.fixtures.ts`
- **Done when:** `PublicOff` is `vitest-ci`; play checks the enable switch and the copy control; store is `useState(() => factory())`; `createShare` updates that instance only
- **Verify with:** Storybook Vitest with `STORYBOOK_A11Y_GATE=1`
- **Parallel with:** `chunk-b-trash-plays`

### Chunk B: Trash plays

- **id:** `chunk-b-trash-plays`
- **Skill:** storybook
- **Inputs:** Drive modal harness, Docs home stories
- **Done when:** Drive confirm and Cancel are sibling `vitest-ci` stories; Docs row menu confirms trash; spies `waitFor` `renameItem` with fixture `from` and `apiPathFromUiPath(DRIVE_TRASH_UI_PATH, …)`
- **Verify with:** Storybook Vitest with `STORYBOOK_A11Y_GATE=1`
- **Parallel with:** `chunk-a-share-play`

## Test plan

- [ ] Storybook smoke on the new stories with `STORYBOOK_VITEST_SMOKE=1` and `STORYBOOK_A11Y_GATE=1`
- [ ] Local apps done gate (jsdom skipped; RSVP cited as CI-only)
