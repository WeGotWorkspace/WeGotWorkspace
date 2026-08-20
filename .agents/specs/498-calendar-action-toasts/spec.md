Source: #498 (body-hash: 357b2508)
Goal: #478

# Toasts with undo for key Calendar actions

Technical translation of Task #498 — persist success for event save/update and invitation status changes through the existing suite toast + undo queue.

## Goal

Create/update event and accept/decline/tentative RSVP show a **suite** success toast with **Undo**. Undo restores the previous persisted event (delete created / re-patch original) or previous `PARTSTAT` via the scheduling respond API. Delete already uses this pattern; save and RSVP must join it.

## Non-goals

- Undo for sidebar show/hide or view changes
- Push / local alerts (#390)
- Mail-app toasts
- A Calendar-only toast stack (`useAppToast` + `useQueuedMutation` only)

## Affected packages

- packages/apps (`calendar-core`, shared `use-queued-mutation`)
- `.agents/specs/498-calendar-action-toasts/`

## Technical constraints

- Reuse `useQueuedMutation` (`canUndo`, `undoLatest` / Cmd+Z) — same hook as event delete.
- Save/update: `executeImmediately` so existing save tests and the created id stay available for undo-delete.
- RSVP: queue after the occurrence-scope dialog (reuse `persistInviteeRsvp`); undo calls `respond` with the previous accepted/tentative/declined status.
- BEM/CSS unchanged; labels only.

## Edge cases

- First RSVP from `needs-action`: API cannot restore `needs-action`; Undo is a no-op when there is no revertible `PARTSTAT`.
- This-and-future / calendar-move: best-effort undo (delete fork / delete moved copy and restore original).
- Failed persist: existing error toast; do not treat failure as undoable success.
