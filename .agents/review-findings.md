# Review findings

Intake for recurring review findings. Skills and lints are the memory. This file is the inbox.

Before planning, and before a security or invariant chunk, read **Active** rows (`promoted-to` empty).

When review feedback arrives, append one English line per new recurring finding, then fix. A plan review counts. `promoted-to` may be [plan-feature](skills/plan-feature/SKILL.md). A finding that shows up twice is promoted into a skill or lint. A security finding is promoted on the first occurrence. Do not let this file become a second policy. [code-review](skills/code-review/SKILL.md) does not re-check promoted rows.

This intake is new. After a few weeks, check whether unpromoted findings shrink, or whether the same mistakes only move. Do not add a tracking system for that check.

## Active

- 2026-10-06: A path rewrite can carry a grant into a location that must not grant access (a share followed its folder into product trash and stayed live).

## Promoted

| Date | Finding | Example | Promoted to |
|------|---------|---------|-------------|
| 2026-09-28 | A green suite did not pin the old contract | Notes YAML stars; a cross-boundary `openapi.json` input can hash wrong while typegen stays green | [testing/test-first.md](skills/testing/test-first.md) |
| 2026-09-28 | A security control matched the letter and missed the bypass | Rate-limit key the caller can mint; body buffered before the size cap | [security/SKILL.md](skills/security/SKILL.md) |
| 2026-09-28 | An unresolved choice was treated as decided during implementation | The same choice left open across review rounds | [plan-feature/SKILL.md](skills/plan-feature/SKILL.md) |
| 2026-09-28 | A rewrite dropped a decided section without saying so | A later draft removed a previously decided section | [plan-feature/SKILL.md](skills/plan-feature/SKILL.md) |
| 2026-09-28 | Plan or tasks status was cited as proof | A checklist counted complete while items were not planned | [verify-issue/SKILL.md](skills/verify-issue/SKILL.md) |
| 2026-09-28 | A premise about code, a dependency, or issue status had no source that supports it | #525 blocked on room IDs the Goal did not need; #568 depending on #566 when it did not | [plan-feature/SKILL.md](skills/plan-feature/SKILL.md) |
| 2026-09-28 | A chunk boundary was not shippable on its own | A half-landed stack broke the build; a chunk broke the old client until a later chunk | [plan-feature/SKILL.md](skills/plan-feature/SKILL.md) |
| 2026-09-28 | Infra or config could fail quietly with no signal | Cross-boundary `openapi.json` hash stays green; a runtime image with unpinned versions | [plan-feature/SKILL.md](skills/plan-feature/SKILL.md) |
| 2026-09-28 | Work drawn from a budget did not name what it displaces | The install matrix grew inside the #584 budget; a chunk was not on the sprint plan | [plan-feature/SKILL.md](skills/plan-feature/SKILL.md) |
| 2026-09-28 | The first design did not name the existing component it could have used | A new component chosen where one already provides the behavior | [plan-feature/SKILL.md](skills/plan-feature/SKILL.md) |
