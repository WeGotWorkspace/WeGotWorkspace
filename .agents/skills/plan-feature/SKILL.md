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

**Language:** `spec.md`, `plan.md`, `tasks.md`, and the delivery issue are **English** even if the user prompt is Dutch — [english-only.md](../developer/english-only.md).

Skeletons: [specs/_template/](../../specs/_template/). On scope change: update the **delivery** issue first, then re-sync all three files + body-hash.

## Filing issues first

If the delivery issue does not exist yet, file it before writing `spec.md`. Short checklist: [developer/issue-filing.md](../developer/issue-filing.md). **English** title and body — [english-only.md](../developer/english-only.md).

1. Classify: Goal | Epic | Task | Chore | Bug
2. Goal → product language; `type:goal`; Product Project at Status **Identified** (or **Adopted** if already committing); **no milestone**; never sole `fixes #` / `Source:`
3. Epic → `type:epic`; required parent Goal; not on Product Project; milestone OK for release packing
4. Task → `type:task`; parent Epic or Goal; implementable `- [ ]` AC; not on Product Project; milestone OK
5. Chore → `type:chore`; no Goal required. Bug → `bug-report.yml` (GitHub issue type **Bug**); not on Product Project
6. Prefer templates `goal.yml` / `epic.yml` / `task.yml` / `chore.yml` / `bug-report.yml` under `.github/ISSUE_TEMPLATE/` (or `gh issue create --template`); specialized `dast-finding.yml`
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
- [ ] Active rows in [review-findings.md](../../review-findings.md) (empty `promoted-to`)

## Plan template

Write to `.agents/specs/<N>-<slug>/plan.md` (or inline for trivial non-`feat/` work):

```markdown
# [Feature title]

## Goal
[One paragraph]

## Budget
Draws from budget X, displaces Y.

## Non-goals
- …

## What exists
- [Claim about existing code, a dependency, or issue status.] `path: packages/api/app/Example.php:1`

## Considered
Considered: [existing component], [alternative] — chosen or rejected because [reason].

## Affected packages
- packages/api | packages/apps | docs

## Dependencies
[Ordered list — what must complete before what]

## Open decisions
None — every choice is made. Or checkboxes tied to a chunk id while a choice is still open.

## Invariants
- [Behavior that must keep working]. A wrong change [what breaks]. Proof: `path: packages/api/tests/ExampleTest.php` assertion `test_name`, or a command that shows a silent miss.
- After chunk A, main still works without the next chunk. Proof: the test or command named above.

## Chunks

### Chunk A: [name]
- **Skill:** api | apps-ui | workspace | testing | document | storybook | security
- **Inputs:** cited claim — `path: packages/api/app/Example.php:1`
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

`None` under Invariants is valid only when the diff touches nothing outside `docs/` and `.agents/`. A happy-path test of the new behavior does not fill an invariant row. Infra and config often have no unit test; name the command that shows the silent miss instead. Hedges belong only under Open decisions. Do not start a chunk listed under an open checkbox. Chunk **Done when** and **Verify with** are decisions.

Every claim about existing code, a dependency, or issue status under What exists or chunk **Inputs** cites a `path:line`, a command output line, or a `gh issue view` excerpt. An uncited premise is an open decision labeled "to verify". The citation has to support the claim. A link alone is not enough.

On a rewrite, do not drop a previously decided section. If a heading from the previous revision is gone, add `## Removed since previous revision` and name it with a why, or `renamed <old> → <new>` when `<new>` is a heading in the new file. Keeping the old heading text does not replace that note. If an existing component already provides the behavior, say so instead of designing a second one. The Considered line is required on the first draft, not only on a rewrite.

Do not record chunk completion in the plan or in `tasks.md`. The GitHub issue and the test or file that proves the claim are the record.

## Self-review

Run this before handing the plan off. It is a checklist, not a second document.

- [ ] Active rows in [review-findings.md](../../review-findings.md) were read
- [ ] What exists and Inputs: each premise has a source, and the source supports the claim
- [ ] Invariants: behavior, break, and proof (test file + assertion, or a command). One row per chunk boundary. `None` only for a docs-and-agents diff
- [ ] Open decisions is present (`None`, or checkboxes tied to a chunk id). No chunk starts while its checkbox is open
- [ ] Considered line names the existing component and the alternative
- [ ] Budget line names what this work draws from and what it displaces
- [ ] Chunk sections contain no deferral markers (`TBD`, `TODO`, `FIXME`, `decide later`, `???`)
- [ ] A rewrite names every removed or renamed heading under Removed since previous revision

## Parallelization

**Canonical rules:** [developer/multitask.md](../developer/multitask.md) — safe vs sequential ordering, red-green vs verify chunks, handoffs, post-parallel sync. **Do not restate those rules in plans**; set **Parallel with** on each chunk instead.

## Quality bar

Chunk `done-when` should reference:

- [verify-issue](../verify-issue/SKILL.md) when work tracks a GitHub issue
- [developer/done-checklist.md](../developer/done-checklist.md) commands where applicable
- Domain skill requirements (e.g. API feature tests, apps-ui CSS rules)
- [clean-code](../clean-code/SKILL.md) smells checklist on touched files
- [.agents/POLICY.md](../../POLICY.md) for policy vs enforced expectations
- [security](../security/SKILL.md) when a chunk is a pre-auth path, an upload or parser of caller-supplied input, or a cache or limiter key derived from caller input

**Collab / text-editor UI:** split plan chunks into **pure lib** (schema, map writes, editor actions — Vitest on exports) vs **orchestrator** (sub-hooks + thin public hook — RTL on contracts). See [workspace/collab-hooks.md](../workspace/collab-hooks.md).
