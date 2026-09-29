# Default list, address book, and notebook settings

Derived from [spec.md](./spec.md). Sequential chunks. Source Task #983.

## Goal

Device-local default collections for Tasks, Contacts, and Notes in Settings and the in-app dialog, wired to New while All is selected.

## Budget

Parent Goal #971 / Epic #972. Lands on the #973 settings-registry PR. Displaces no Adopted v0.9 packing.

## Non-goals

See [spec.md](./spec.md).

## What exists

- Registry + Mail + Calendar Apps panels; Tasks/Contacts/Notes footers already pass `appId`. `path: packages/apps/src/settings-core/src/register-builtin-settings.tsx:47`
- Calendar Default calendar picker in `lib/` with `showName`. `path: packages/apps/src/lib/calendar-event-calendar-picker.tsx:60`
- Tasks All view create uses Inbox via `defaultTaskListId`. `path: packages/apps/src/tasks-core/src/use-tasks-shell.tsx:99`
- Contacts All view create uses `isDefault` via `resolveCreateAddressBookIds`. `path: packages/apps/src/contacts-core/src/contacts-edit-utils.ts:115`
- Notes All view create uses `personalNotebooks[0]`. `path: packages/apps/src/notes-core/src/notes-note-utils.ts:719`

## Considered

Considered: OpenAPI user prefs — rejected; #983 AC forbids a new API.
Considered: settings-core importing product cores for collection lists — rejected; registry constraint.
Considered: one shared pane component with per-app wrappers — chosen; three copy-pasted panes would drift.

## Affected packages

- packages/apps

## Dependencies

1. Chunk 0 specs exist (this folder).
2. Prefs + loaders (A) before panes (B) and create-target wiring (C).
3. Panes (B) can land before wiring (C); nav appears as soon as the slice is reachable.
4. After chunk B, Mail and Calendar still work without C.

## Open decisions

None — every choice for this work is made.

## Invariants

- Mail and Calendar remain under Apps. Proof: `path: packages/apps/src/settings-core/src/settings-registry.test.ts` assertion `keeps Mail and Calendar under Apps`.
- After chunk A, existing view-prefs keys are untouched. Proof: `path: packages/apps/src/lib/default-collection-prefs.test.ts`
- After chunk C, a list/book/notebook sidebar view still creates into that collection. Proof: existing `book:work` / `nb:Ideas` / `list:` tests plus new preferred-id cases.
- Drive still hides the Settings row. Proof: `path: packages/apps/src/settings-core/stories/settings-dialog.stories.tsx` HiddenForDrive.

## Chunks

### Chunk 0: Spec from Task #983

- **id:** `file-spec`
- **Skill:** plan-feature
- **Inputs:** Task #983 body-hash `57237024`
- **Done when:** spec/plan/tasks exist with `Source: #983 (body-hash: 57237024)` and `Goal: #971`
- **Verify with:** `gh issue view 983 --json body --jq .body | shasum -a 256`
- **Parallel with:** none

### Chunk A: Prefs + picker collections

- **id:** `default-prefs`
- **Skill:** apps-ui
- **Inputs:** Calendar display-prefs + picker-collections pattern
- **Done when:** `lib/default-collection-prefs.ts` reads/writes; `lib/app-picker-collections.ts` mock/live lists; unit tests
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/lib/default-collection-prefs.test.ts src/lib/app-picker-collections.test.ts`
- **Parallel with:** none

### Chunk B: Settings panes + registry

- **id:** `collection-panes`
- **Skill:** workspace, storybook
- **Inputs:** Chunk A
- **Done when:** tasks/contacts/notes panels + slices; rhf pane; save notifies; stories; Apps nav is Mail, Calendar, Tasks, Contacts, Notes; Drive hides the footer row
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/settings-core/src/settings-registry.test.ts src/settings-core/src/settings-default-collection-pane.test.tsx src/settings-core/src/use-settings-default-collection-form-saved.test.tsx src/settings-core/src/settings-dialog-footer.test.tsx`
- **Parallel with:** none

### Chunk C: Apply prefs to New

- **id:** `create-wiring`
- **Skill:** workspace
- **Inputs:** Chunk A
- **Done when:** All-view New uses the stored id; single-collection views ignore it; Tasks composer default updates after save
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/tasks-core/src/tasks-task-utils.test.ts src/tasks-core/src/use-tasks-controller.test.tsx src/contacts-core/src/contacts-edit-utils.test.ts src/notes-core/src/notes-note-utils.test.ts src/notes-core/src/notes-create-target.test.ts`
- **Parallel with:** chunk B

## Test plan

- [ ] Vitest for prefs parse/write and picker mock lists
- [ ] Registry/nav/dialog: Mail + Calendar + Tasks + Contacts + Notes; Drive hidden
- [ ] Create-target helpers honor stored ids only on All
- [ ] Local apps done gate before push
