Source: #1894 (body-hash: 57d6d42d)

# Tasks notice bar

## Goal

Tasks shows what needs the user's attention after working offline in a bar between the main header and the task list, instead of a header button and a toast. One shared component, `NoticeBar`, stacks one line per notice: "Some changes could not sync. They are saved on this device." with Retry, and below it "3 tasks from 2 lists need a new list" with Review, which opens the shared rescue dialog. A notice cannot be dismissed; it goes away when what it reports is resolved. Notes, Contacts, Docs, Drive and Calendar move to the same bar in #1895.

## Non-goals

- Changing the rescue dialog (`rescue-ui/rescue-dialog.tsx`).
- Making Notes, Calendar or Contacts park refused writes.
- The other apps (#1895).

## Affected packages

- packages/apps

## Technical constraints

- `NoticeBar` composes the existing `Callout` (severity tokens, icon, action slot) and only reshapes it into a full-width bar. Copy comes from the app.
- Placement is a layout slot, not `position: sticky`: `WorkspaceAppLayout.mainNotice` sits between `mainHeader` and `main-scroll`. `WorkspaceApp` (Notes, Contacts) gets the same slot in #1895.
- The region has an accessible name from the app ("Needs your attention") and `aria-live="polite"`.
- The rescue row comes from `rescueNotice()` in `rescue-ui`, so every app that adopts the rescue dialog gets the same row; its words are `RescueLabels.notice` and `review`.
- The sync row counts outbox rows that `isSyncNoticeOutboxRow` accepts, through `useFailedOutboxCount`, the poll Notes and Contacts already used, now shared.
- Phone width (375px): the sentence wraps and the action stays visible.

## Edge cases

- Both notices at once: sync on top, rescue below.
- Review while the dialog is open in another tab: the existing "open in another Tasks tab" toast (`useParkedWrites` one-tab lock).
- Retry while still offline or still blocked: the row stays and the button is enabled again after the attempt.
- A refused write (403/404) is parked and leaves the outbox, so it shows as a rescue notice, never as "could not sync".
