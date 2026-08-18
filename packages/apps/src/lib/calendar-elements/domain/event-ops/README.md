# Headless Event Operations API

This module provides a pure, method-based API for client-side calendar operations.
It is intentionally UI-agnostic so the same logic can be used by Lit components,
storybook handlers, and future tooling integrations.

## Main surface

- `EventsAPI`
  - `create()`
  - `update()`
  - `move()` (delta-only)
  - `resizeStart()`
  - `resizeEnd()`
  - `remove()`
  - `addExclusion()`
  - `removeExclusion()`
  - `addException()`
  - `removeException()`
  - `expand()`

## Targeting

All mutating operations accept either:

- `target: { key }` for direct map-key updates
- `target: { eventId, calendarId?, recurrenceId? }` for semantic lookup

## Time ranges

Create/update style inputs support both:

- `{ start, end }`
- `{ start, duration }`

The reducer normalizes to canonical `start/end` internally.

## Recurrence semantics

- `expandEvents()` handles recurrence generation, exclusion dates, and detached exceptions.
- Detached exceptions suppress generated master occurrences using `eventId + recurrenceId`.
- Deleting an exception can be turned into a lasting exclusion via `removeException({ asExclusion: true })`.

## Integration pattern

1. Translate UI request events into API calls.
2. Apply operation with `EventsAPI`.
3. Replace UI state with `result.nextState`.
4. Optionally inspect `result.changes` / `result.effects` for side-effects.
