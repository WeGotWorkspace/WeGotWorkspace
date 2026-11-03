Source: ad-hoc

# Rescue notice bar

Ad-hoc design work after the #1877 review. No GitHub Task yet: one is filed once Wouter picks an option, and this spec's `Source:` then moves to it.

## Goal

Replace the rescue header button ("Tasks from 2 lists need a new list") with a shared, non-dismissable notice bar. The bar sits between an app's main header and its scrolling content, says what waits (how many items, from how many containers), and opens the shared rescue dialog. Tasks is the first app to use it. Notes, Calendar and Contacts use the same bar when they adopt the rescue dialog.

Wouter's request (2026-11-03, after the #1877 review): he likes the dialog but not the button, also not in the other apps, and asked for "a (sticky) notification bar".

## Non-goals

- Changing the rescue dialog itself (`rescue-ui/rescue-dialog.tsx`).
- Making refused writes park in Notes, Calendar or Contacts. That is each app's own adoption work (see the #1877 description).
- Replacing toasts in general. Only notices that wait on the user belong in the bar.

## Affected packages

- packages/apps

## Technical constraints

- One shared component, `notice-bar/src/notice-bar.tsx`, built on the existing `Callout` (severity tokens, icon, action slot). Its copy comes from the app, like `RescueLabels`.
- Placement is a layout slot, not `position: sticky`: `WorkspaceAppLayout` gets `mainNotice` between `mainHeader` and `main-scroll`. `WorkspaceApp` (Notes, Contacts) needs the same slot under its list header when those apps adopt it.
- The bar cannot be dismissed while items wait. It disappears when the app clears them.
- Phone width (375px): the copy wraps and the action stays visible; nothing runs off the edge (the header button did).
- The region has an accessible name and `aria-live="polite"`, so a new notice is announced once.

## Edge cases

- Two or more containers waiting: one notice with the total, not one bar per container (option B adds per-container rows).
- The dialog is open in another tab: Review shows the existing "open elsewhere" toast (`useParkedWrites` one-tab lock).
- A docked bar (option C) shares the bottom edge with the floating selection bar (`floating-action-bar`) and covers the end of the list unless the content gets extra bottom padding.
- A second kind of notice (sync stuck) arriving while a rescue notice shows: stacked in the same bar or kept as today's toast. This is an open decision for Wouter.
