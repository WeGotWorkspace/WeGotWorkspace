Source: #793 (ad-hoc folder — re-home to `793-suite-notify-expansion` with body-hash after first implement PR)
Goal: #390

# Suite notify inbox expansion (ad-hoc)

Technical planning for expanding curated notify producers beyond Epic [#741](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/741). Full research, catalog, chunks, and filed Epic/Tasks live in:

[`.agents/plans/suite-notify-inbox-expansion.md`](../../plans/suite-notify-inbox-expansion.md)

## Goal

Add allow-listed producers for Docs threads, Drive share ACL delta (`docs.shared` only), Calendar RSVP + collection shares, Notes/Tasks access, task status changes, Meet started, and chat mentions (after persistence).

## Non-goals

See the plan. Do not expand #741’s original first-producer scope retroactively. Delivery Epic: [#793](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/793).

## Status

- Research complete (write-path table in the plan).
- Product decisions **resolved** (share key, Docs recipients, Meet/task recipients, chat mention dedupe) — recorded in the plan.
- GitHub issues **filed:** Epic #793; Tasks #794–#801; Chore #802 (prefs tracking).
- No production implementation in the planning pass.

## Filed delivery

| Issue | Role |
|-------|------|
| [#793](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/793) | Epic (parent Goal #390) |
| [#794](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/794) | Docs thread activity (#548 comment) |
| [#795](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/795) | Drive `updateShare` / `docs.shared` delta |
| [#796](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/796) | Calendar RSVP |
| [#797](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/797) | Collection access granted |
| [#798](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/798) | Task status changed |
| [#799](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/799) | Meet started |
| [#800](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/800) | Chat mention + dedupe |
| [#801](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/801) | Docs mention (#549) |
| [#802](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/802) | Prefs tracking Chore (no impl now) |

**Chosen share `domain.action`:** `docs.shared` (single key; navigate `/docs` vs `/drive`).

## Next

1. Re-home this into `.agents/specs/793-suite-notify-expansion/` with `Source: #793 (body-hash: …)` (or first Task when implementing a slice).
2. Implement Chunk A (#794) first on `feat/suite-notify` or a follow-up `feat/` branch.
