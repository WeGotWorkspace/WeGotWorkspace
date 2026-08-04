# Issue filing checklist (Goal / Epic / Task / Chore / Bug)

Use when creating or classifying GitHub issues. Product intent: [docs/product/](../../../docs/product/), [GOVERNANCE.md](../../../GOVERNANCE.md). Delivery → specs: [plan-feature](../plan-feature/SKILL.md), [specs/README.md](../../specs/README.md).

## Checklist

1. **Classify:** Goal | Epic | Task | Chore | Bug
2. **Goal** → product language (Outcome / Who / Success looks like / Non-goals); label `type:goal`; add to [Product Project](https://github.com/orgs/WeGotWorkspace/projects/1); never sole `fixes #` / never `Source:` for `spec.md`
3. **Epic** → `type:epic`; **required** parent Goal; **not** on Product Project (even when parented under a Goal)
4. **Task** → `type:task`; parent Epic or Goal; implementable `- [ ]` AC; **not** on Product Project
5. **Chore / bug** → `type:chore` or `bug-report.yml` (`bug` label); no Goal required; **not** on Product Project. Security/DAST: `dast-finding.yml`
6. Prefer templates under [`.github/ISSUE_TEMPLATE/`](../../../.github/ISSUE_TEMPLATE/) — [`goal.yml`](../../../.github/ISSUE_TEMPLATE/goal.yml), [`epic.yml`](../../../.github/ISSUE_TEMPLATE/epic.yml), [`task.yml`](../../../.github/ISSUE_TEMPLATE/task.yml), [`chore.yml`](../../../.github/ISSUE_TEMPLATE/chore.yml), [`bug-report.yml`](../../../.github/ISSUE_TEMPLATE/bug-report.yml) (or `gh issue create --template`). Specialized: [`dast-finding.yml`](../../../.github/ISSUE_TEMPLATE/dast-finding.yml)
7. `feat/` closes **Task/Epic**; `spec.md` `Source:` from that issue — **not** a Goal

## Quick matrix

| Kind | Label | Parent | Product Project? | Spec `Source:`? |
|------|-------|--------|------------------|-----------------|
| Goal | `type:goal` | — | Yes | Never |
| Epic | `type:epic` | Goal required | No | Yes (delivery) |
| Task | `type:task` | Epic or Goal | No | Yes (delivery) |
| Chore | `type:chore` | Optional | No | Usually no `feat/` |
| Bug | `bug` | Optional | No | Usually no `feat/` |

## Product Project hygiene

Only **Goals** belong on [Product roadmap](https://github.com/orgs/WeGotWorkspace/projects/1). New Tasks / Epics / Chores / Bugs must **not** be added. If automation or sub-issue linkage re-adds them, remove the Project item and keep the board filter `label:type:goal`. Browse kit: [docs/product/README.md](../../../docs/product/README.md#how-to-browse).

## Parked / Later work

When a Goal is **Later** (or otherwise deferred) and the design is already worked out across many satellite issues:

1. Keep the **Goal** open on the Product Project (`Later`).
2. Keep **one Epic** open under that Goal; expand its body with titled sections that **preserve full plans and AC** from each former satellite (e.g. `### From #345 — <title>`), or a durable doc under `docs/` if the epic body would be huge.
3. Comment on each satellite with a pointer to the epic section (or doc path) + Goal, then **close** them (`not_planned` is fine for parked work).
4. Do **not** leave long open satellite issues, and do **not** put the Epic or satellites on the Product Project.

When the Goal leaves Later, re-open or create Tasks from those epic sections — do not re-scatter open trackers until delivery starts.

Example: Goal #391 + Epic #349 (former E2EE satellites #335–#348 absorbed).

## After filing

- Planning / specs: [plan-feature](../plan-feature/SKILL.md)
- Verify before handoff: [verify-issue](../verify-issue/SKILL.md) (Goal vs Task/Epic modes)
