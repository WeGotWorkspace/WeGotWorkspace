# Issue filing checklist (Goal / Epic / Task / Chore / Bug)

Use when creating or classifying GitHub issues. Product intent: [docs/product/](../../../docs/product/), [GOVERNANCE.md](../../../GOVERNANCE.md). Delivery → specs: [plan-feature](../plan-feature/SKILL.md), [specs/README.md](../../specs/README.md).

## Three surfaces

| Surface | Issues | Notes |
|---------|--------|-------|
| Product | `type:goal` on [Product Project](https://github.com/orgs/WeGotWorkspace/projects/1) | Status = Identified → Adopted → Fulfilled |
| Delivery | `type:epic` / `type:task` / `bug` | Implementable work; **not** on Product Project |
| Release targets & eng packing | GitHub milestones | Soft target on Goals; `v0.9` / `v1.0` also pack Epics/Tasks/Bugs |

**Milestones may attach to Goals** (soft release target for when we aim to fulfill). Still OK on Epics/Tasks/Bugs for eng packing. Far-horizon Goals stay `Identified` or `Adopted` until product marks Fulfilled — **milestone ≠ Fulfilled**. Eng progress is on child issues — Goal Status stays **Adopted** while building.

**Intake:** anyone may explore in GitHub Discussions; **maintainers** file Goals (and Epics/Tasks/Chores) and set Project Status to **Identified** or **Adopted**. Do not put Exploring/Proposed on the board. Externals file bugs / Discussions only — see [CONTRIBUTING.md](../../../CONTRIBUTING.md).

## One outcome per Goal

**One Goal ticket = one user outcome** that can be fulfilled independently.

- Do **not** bundle multiple fulfillable outcomes into one Goal (e.g. “calendars + events + sharing”). Split into sibling Goals.
- Do **not** parent a Goal under another Goal. Group related Goals with `area:*` labels and an optional shared milestone — not Goal→Goal hierarchy.
- **Design language / suite consistency** is a **Non-goal constraint** (or success signal) on each Goal that needs it — not its own Goal.
- Goal labels: `type:goal` + one or more `area:*` (+ optional milestone). Do not invent extra product labels for grouping.

## Checklist

1. **Classify:** Goal | Epic | Task | Chore | Bug
2. **Goal** → **one** fulfillable user outcome; product language (Outcome / Who / Success looks like / Non-goals); label `type:goal` + `area:*`; add to [Product Project](https://github.com/orgs/WeGotWorkspace/projects/1) at Status **Identified** (or **Adopted** if already committing); optional milestone as soft release target (≠ Fulfilled); **no** Goal parent; never sole `fixes #` / never `Source:` for `spec.md`
3. **Epic** → `type:epic`; **required** parent Goal; **not** on Product Project (even when parented under a Goal); milestone OK for release packing
4. **Task** → `type:task`; parent Epic or Goal; implementable `- [ ]` AC; **not** on Product Project; milestone OK for release packing
5. **Chore / bug** → `type:chore` or `bug-report.yml` (`bug` label); no Goal required; **not** on Product Project. Security/DAST: `dast-finding.yml`. Bugs may take a milestone; chores usually do not compete as roadmap
6. Prefer templates under [`.github/ISSUE_TEMPLATE/`](../../../.github/ISSUE_TEMPLATE/) — [`goal.yml`](../../../.github/ISSUE_TEMPLATE/goal.yml), [`epic.yml`](../../../.github/ISSUE_TEMPLATE/epic.yml), [`task.yml`](../../../.github/ISSUE_TEMPLATE/task.yml), [`chore.yml`](../../../.github/ISSUE_TEMPLATE/chore.yml), [`bug-report.yml`](../../../.github/ISSUE_TEMPLATE/bug-report.yml) (or `gh issue create --template`). Specialized: [`dast-finding.yml`](../../../.github/ISSUE_TEMPLATE/dast-finding.yml)
7. `feat/` closes **Task/Epic**; `spec.md` `Source:` from that issue — **not** a Goal

## Quick matrix

| Kind | Label | Parent | Product Project? | Milestone? | Spec `Source:`? |
|------|-------|--------|------------------|------------|-----------------|
| Goal | `type:goal` (+ `area:*`) | — (never another Goal) | Yes | Yes (soft target) | Never |
| Epic | `type:epic` | Goal required | No | Yes (packing) | Yes (delivery) |
| Task | `type:task` | Epic or Goal | No | Yes (packing) | Yes (delivery) |
| Chore | `type:chore` | Optional | No | Optional | Usually no `feat/` |
| Bug | `bug` | Optional | No | Yes (packing) | Usually no `feat/` |

## Offline / hybrid sync

There is **no** `offline` GitHub label (do not recreate it). Group offline work via parent **Goals** (e.g. #381 Docs/Notes, #400 Mail) and `area:*` on the Goal and delivery issues. See [docs/product/README.md](../../../docs/product/README.md#labels).

## Product Project hygiene

Only **Goals** belong on [Product roadmap](https://github.com/orgs/WeGotWorkspace/projects/1). New Tasks / Epics / Chores / Bugs must **not** be added. If automation or sub-issue linkage re-adds them, remove the Project item and keep the board filter `label:type:goal`. Browse kit: [docs/product/README.md](../../../docs/product/README.md#how-to-browse).

## Parked / far-horizon work

When a Goal is **Adopted** but delivery has not started yet, and the design is already worked out across many satellite issues:

1. Keep the **Goal** open on the Product Project (`Adopted`).
2. Keep **one Epic** open under that Goal; expand its body with titled sections that **preserve full plans and AC** from each former satellite (e.g. `### From #345 — <title>`), or a durable doc under `docs/` if the epic body would be huge.
3. Comment on each satellite with a pointer to the epic section (or doc path) + Goal, then **close** them (`not_planned` is fine for parked work).
4. Do **not** leave long open satellite issues, and do **not** put the Epic or satellites on the Product Project.

When delivery starts under an Adopted Goal, re-open or create Tasks from those epic sections — do not re-scatter open trackers until delivery starts. Goal Status stays **Adopted** until product marks **Fulfilled**.

Example: Goal #391 + Epic #349 (former E2EE satellites #335–#348 absorbed).

## After filing

- Planning / specs: [plan-feature](../plan-feature/SKILL.md)
- Verify before handoff: [verify-issue](../verify-issue/SKILL.md) (Goal vs Task/Epic modes)
