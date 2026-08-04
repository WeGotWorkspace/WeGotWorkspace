---
name: plan-feature
description: Feature planning workflow for the WeGotWorkspace monorepo — research checklist, plan template, parallelization rules, and chunk handoffs. Use when scoping a feature, breaking down work, or preparing for multitask builds.
---

# Feature planning

## Spec-first workflow

For feature work, planning produces **committed files** under `.agents/specs/<N>-<slug>/`:

```text
Goal (product, optional) → Epic/Task (AC) → spec.md → plan.md → tasks.md
```

| Step | File | Action |
|------|------|--------|
| 0 | Goal | If work delivers a user outcome, ensure a parent `type:goal` exists ([docs/product/](../../../docs/product/)). Goals are **context only** — never `Source:`. |
| 1 | `spec.md` | `gh issue view <N>` on the **Task or Epic** → technical translation; header `Source: #<N> (body-hash: xxxxxxxx)`; optional `Goal: #M` (not hashed) |
| 2 | `plan.md` | Chunk split using template below |
| 3 | `tasks.md` | Engineering rows per chunk (id, owner, paths, verify) — **not** issue `- [ ]` checklist |

**Bridge rules:**

- `feat/` work links a **Task or Epic** as the closing issue — never a Goal alone.
- Do not derive `spec.md` from a Goal body (no eng AC / body-hash there).
- Pure eng chores (`type:chore`) need no Goal; still use a Task/Epic if they need a `feat/` spec.

**Folder name:** `<issue-number>-<slug>` where `<issue-number>` is the **Task/Epic** (e.g. `.agents/specs/134-drive-share/`). Without issue: `.agents/specs/000-ad-hoc-slug/` with `Source: ad-hoc`.

**When required:** `feat/` branches — see [specs/README.md](../../specs/README.md). `fix/` / `chore/` / `docs/` — optional.

Skeletons: [specs/_template/](../../specs/_template/). On scope change: update the **delivery** issue first, then re-sync all three files + body-hash.

## Filing issues first

If the delivery issue does not exist yet, file it before writing `spec.md`. Short checklist: [developer/issue-filing.md](../developer/issue-filing.md).

1. Classify: Goal | Epic | Task | Chore/bug
2. Goal → product language; `type:goal`; Product Project; never sole `fixes #` / `Source:`
3. Epic → `type:epic`; required parent Goal; not on Product Project
4. Task → `type:task`; parent Epic or Goal; implementable `- [ ]` AC
5. Chore → `type:chore`; no Goal required
6. Prefer templates `goal.yml` / `epic.yml` / `task.yml` / `chore.yml` (+ `bug-report.yml`) under `.github/ISSUE_TEMPLATE/` (or `gh issue create --template`)
7. `feat/` closes Task/Epic; `spec.md` `Source:` from that issue — not Goal

## When to plan

Plan before building when:

- Multiple packages touched (API + UI)
- OpenAPI or shared CSS contract changes
- Requirements are unclear or conflicting
- Work will run in parallel across agents

Skip formal planning for single-file fixes with obvious scope.

## Research checklist

Before writing the plan:

- [ ] Delivery issue (Task/Epic): fetch with `gh issue view`; generate `spec.md` **from** that body (not from a Goal). Optional parent Goal for context.
- [ ] Body-hash for spec header: `gh issue view <N> --json body --jq .body | shasum -a 256` (first 8 hex chars) on the **Source** issue
- [ ] Copy acceptance criteria into chunk `done-when` — verify later with [verify-issue](../verify-issue/SKILL.md) (Task/Epic mode)
- [ ] Relevant domain skill (`api`, `apps-ui`, `workspace`)
- [ ] OpenAPI contract if API involved: `packages/api/openapi/openapi.json`
- [ ] Done gate if API involved: `packages/api/docs/api-done-gate.md`
- [ ] Existing tests and stories for the area
- [ ] `developer/multitask.md` if parallel execution expected

## Plan template

Write to `.agents/specs/<N>-<slug>/plan.md` (or inline for trivial non-`feat/` work):

```markdown
# [Feature title]

## Goal
[One paragraph]

## Non-goals
- …

## Affected packages
- packages/api | packages/apps | docs

## Dependencies
[Ordered list — what must complete before what]

## Chunks

### Chunk A: [name]
- **Skill:** api | apps-ui | workspace | testing | document | storybook
- **Inputs:** …
- **Done when:** …
- **Verify with:** command or checklist
- **Parallel with:** chunk IDs or "none"

Optional final chunk after parallel builds merge:

- **Chunk V: Cross-chunk verify** — read-only verifier subagent; prompt from [developer/multitask-verifier.md](../developer/multitask-verifier.md); `done-when`: verifier `PASS` or `PASS_WITH_NITS` and parent ran [done-checklist](../developer/done-checklist.md).

## Test plan

- [ ] API: OpenAPI → failing feature test → implement → `composer done-gate` ([testing/test-first.md](../testing/test-first.md))
- [ ] UI: mock-tier Storybook → Vitest for logic → optional `play` for critical flows
- [ ] …

## Doc updates (only if user wants)
- …
```

## Parallelization

**Canonical rules:** [developer/multitask.md](../developer/multitask.md) — safe vs sequential ordering, red-green vs verify chunks, handoffs, post-parallel sync. **Do not restate those rules in plans**; set **Parallel with** on each chunk instead.

## Quality bar

Chunk `done-when` should reference:

- [verify-issue](../verify-issue/SKILL.md) when work tracks a GitHub issue
- [developer/done-checklist.md](../developer/done-checklist.md) commands where applicable
- Domain skill requirements (e.g. API feature tests, apps-ui CSS rules)
- [clean-code](../clean-code/SKILL.md) smells checklist on touched files
- [.agents/POLICY.md](../../POLICY.md) for policy vs enforced expectations

**Collab / text-editor UI:** split plan chunks into **pure lib** (schema, map writes, editor actions — Vitest on exports) vs **orchestrator** (sub-hooks + thin public hook — RTL on contracts). See [workspace/collab-hooks.md](../workspace/collab-hooks.md).
