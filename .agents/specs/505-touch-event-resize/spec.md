Source: #505 (body-hash: cab826e7)
Goal: #385

# Touch resize in day/week timed views

Technical translation of Task #505 — not a copy of the issue AC checklist.

## Goal

Touch users can change a timed event’s start and/or end on the day/week timeline by an explicit resize gesture, without opening the edit dialog. Mouse/fine-pointer resize stays the existing hover-edge handles.

## Non-goals

- Month / all-day-only resize on touch (all-day may reuse the same handle if it falls out of TimeLine)
- Duration edits only via the event dialog
- Recurrence “this occurrence vs series” scope (existing dialog)

## Affected packages

- packages/apps (`calendar-elements` ResizeHandle, TimeLine, CalendarTimelineView)

## Technical constraints

- Do not un-hide the 2px hover bars under `@media (hover: none), (pointer: coarse)`
- Touch resize is two-step: short-press opens the details popover **and** shows larger grabbers on that event only (WCAG 2.2 24px target). Long-press still moves.
- Handle visibility follows the event open in the details popover (React `selectedEventKey`), not hover and not “every on-screen event”
- Initial state: no handles, no resize. Closing the popover hides grabbers
- Unselected coarse handles stay `display: none; pointer-events: none` so scroll, week swipe, and long-press move are not stolen
- Resize snaps and commits on pointer-up using the existing TimeLine resize session
- BEM + `@apply` in CSS; no long Tailwind in TSX

## Edge cases

- Selecting another event (opening its popover) hides the previous grabbers
- Closing the details popover hides grabbers
- Fine pointer: `active` must not change today’s hover-bar look
- Gesture lock already suspends swipe while a resize session is live
