# Issue filing checklist (Goal / Epic / Task / Chore / Bug)

Use when creating or classifying GitHub issues. Product intent: [docs/product/](../../../docs/product/), [GOVERNANCE.md](../../../GOVERNANCE.md). Delivery → specs: [plan-feature](../plan-feature/SKILL.md), [specs/README.md](../../specs/README.md). **Language:** English only, even if the user prompt is Dutch — [english-only.md](english-only.md). **Level:** plain English for Goals and for the `Summary` that opens every delivery issue — [plain-language.md](plain-language.md).

## Three surfaces

| Surface | Issues | Notes |
|---------|--------|-------|
| Product | Every issue in [WeGotWorkspace/Product](https://github.com/WeGotWorkspace/Product), on [Product Project](https://github.com/orgs/WeGotWorkspace/projects/1) | Status = Identified → Adopted → Fulfilled |
| Delivery | `type:epic` / `type:task` / `type:chore` (GitHub type **Task**) / GitHub type **Bug** | Implementable work in this repository; **not** on Product Project |
| Release targets & eng packing | GitHub milestones | Soft target on Goals; `v0.9` / `v1.0` also pack Epics/Tasks/Bugs |

**Cross-repo references:** in issue bodies and specs, write a Goal as `WeGotWorkspace/Product#N`. A bare `#N` points at this repository. Attach Epics and Tasks to their Goal as sub-issues; sub-issues work across the two repositories.

**Milestones may attach to Goals** (soft release target for when we aim to fulfill). Still OK on Epics/Tasks/Bugs for eng packing. Far-horizon Goals stay `Identified` or `Adopted` until product marks Fulfilled — **milestone ≠ Fulfilled**. Eng progress is on child issues — Goal Status stays **Adopted** while building.

**Intake:** anyone may explore in GitHub Discussions; **maintainers** file Goals in the Product repository at Project Status **Identified**, and Epics/Tasks/Chores here. Move to **Adopted** and attach a milestone only when committing that outcome to a release. Identified is a draft backlog — not a customer list. Do not Adopt to look busy. Do not put Exploring/Proposed on the board. Externals file bugs / Discussions only — see [CONTRIBUTING.md](../../../CONTRIBUTING.md).

**Fulfilled → close the Goal** (`completed`). Keep the Project item; board Status stays **Fulfilled**. Issue open/closed is not product status — an open Goal means the outcome is unfinished. Already-closed Fulfilled Goals ([Product#6](https://github.com/WeGotWorkspace/Product/issues/6), [Product#7](https://github.com/WeGotWorkspace/Product/issues/7), …) are the pattern.

## One outcome per Goal

**One Goal ticket = one user outcome** that can be fulfilled independently.

- Do **not** bundle multiple fulfillable outcomes into one Goal (e.g. “calendars + events + sharing”). Split into sibling Goals.
- Do **not** parent a Goal under another Goal. Group related Goals with `area:*` labels and an optional shared milestone — not Goal→Goal hierarchy.
- **Design language / suite consistency** is a **Non-goal constraint** (or success signal) on each Goal that needs it — not its own Goal.
- Goal labels: one or more `area:*` (+ optional milestone). Every issue in the Product repository is a Goal, so there is no kind label and no issue type. Do not invent extra product labels for grouping.

## Checklist

1. **English:** title and body in English (Goals, Epics, Tasks, Chores, Bugs, and every comment). Prompt language does not matter.
   **Plain language:** a Goal is plain English (B1) throughout, with no technical content. Every Epic, Task, Chore, and Bug starts with a `Summary` block (What / Who notices / If we wait) for the product lead; until it does, a workflow keeps the `needs-summary` label on it. Technical content removed from a Goal moves to its Epic, never into the void. Rules and examples: [plain-language.md](plain-language.md).
2. **Classify:** Goal | Epic | Task | Chore | Bug
3. **Goal** → file in [WeGotWorkspace/Product](https://github.com/WeGotWorkspace/Product) (`gh issue create -R WeGotWorkspace/Product --template goal.yml`); **one** fulfillable user outcome; product language (Outcome / Who / Success looks like / Non-goals); labels `area:*` only, no kind label and **no** GitHub issue type (every issue in the Product repository is a Goal); add to [Product Project](https://github.com/orgs/WeGotWorkspace/projects/1) at Status **Identified** (draft; **no milestone**). **Adopted** + optional milestone only when committing to a release (≠ Fulfilled); **no** Goal parent; never sole `fixes #` / never `Source:` for `spec.md`. When product marks **Fulfilled**, close the issue (`completed`) and leave Status Fulfilled on the board.
4. **Epic** → GitHub issue type **Task** and label `type:epic`; **required** parent Goal (add the Epic as a sub-issue of the Goal in WeGotWorkspace/Product); **not** on Product Project (even when parented under a Goal); milestone OK for release packing
5. **Task** → GitHub issue type **Task** and label `type:task`; parent Epic or Goal; implementable `- [ ]` AC; **not** on Product Project; milestone OK for release packing
6. **Chore** → GitHub issue type **Task** and label `type:chore`. **Bug** → `bug-report.yml` (GitHub issue type **Bug**); no Goal required; **not** on Product Project. Security/DAST: `dast-finding.yml`. Bugs may take a milestone; chores usually do not compete as roadmap. Do not replace an existing Bug type.
7. Prefer templates — Goal: [`goal.yml`](https://github.com/WeGotWorkspace/Product/blob/main/.github/ISSUE_TEMPLATE/goal.yml) in the Product repository; delivery: under [`.github/ISSUE_TEMPLATE/`](../../../.github/ISSUE_TEMPLATE/) — [`epic.yml`](../../../.github/ISSUE_TEMPLATE/epic.yml), [`task.yml`](../../../.github/ISSUE_TEMPLATE/task.yml), [`chore.yml`](../../../.github/ISSUE_TEMPLATE/chore.yml), [`bug-report.yml`](../../../.github/ISSUE_TEMPLATE/bug-report.yml) (or `gh issue create --template`). Specialized: [`dast-finding.yml`](../../../.github/ISSUE_TEMPLATE/dast-finding.yml)
8. `feat/` closes **Task/Epic**; `spec.md` `Source:` from that issue — **not** a Goal

## Quick matrix

| Kind | Label | GitHub issue type | Parent | Product Project? | Milestone? | Spec `Source:`? |
|------|-------|------------------|--------|------------------|------------|-----------------|
| Goal | `area:*` only | none | — (never another Goal) | Yes | Yes (soft target) | Never |
| Epic | `type:epic` | **Task** | Goal required | No | Yes (packing) | Yes (delivery) |
| Task | `type:task` | **Task** | Epic or Goal | No | Yes (packing) | Yes (delivery) |
| Chore | `type:chore` | **Task** | Optional | No | Optional | Usually no `feat/` |
| Bug | `needs-triage` | **Bug** | Optional | No | Yes (packing) | Usually no `feat/` |

Titles do **not** repeat the kind. Do not prefix a title with `[Goal]`, `[Task]`, `[Epic]`, or `[Chore]`. Templates omit that prefix. [`.github/workflows/normalize-issue-shape.yml`](../../../.github/workflows/normalize-issue-shape.yml) sets Task on `type:task`, `type:epic`, and `type:chore` when the type is missing, leaves an existing Bug type in place, and strips those prefixes. The Product repository has its own copy that only strips `[Goal]`; Goals get no issue type.

## Offline / hybrid sync

There is **no** `offline` GitHub label (do not recreate it). Group offline work via parent **Goals** (e.g. [Product#4](https://github.com/WeGotWorkspace/Product/issues/4) Docs/Notes, [Product#18](https://github.com/WeGotWorkspace/Product/issues/18) Mail) and `area:*` on the Goal and delivery issues. See [docs/product/README.md](../../../docs/product/README.md#labels).

## Product Project hygiene

Only **Goals** belong on [Product roadmap](https://github.com/orgs/WeGotWorkspace/projects/1). New Tasks / Epics / Chores / Bugs must **not** be added. If automation or sub-issue linkage re-adds them, remove the Project item and keep the board filter `repo:WeGotWorkspace/Product`. Browse kit: [docs/product/README.md](../../../docs/product/README.md#how-to-browse).

## Parked / far-horizon work

When a Goal is **Adopted** but delivery has not started yet, and the design is already worked out across many satellite issues:

1. Keep the **Goal** open on the Product Project (`Adopted`).
2. Keep **one Epic** open under that Goal; expand its body with titled sections that **preserve full plans and AC** from each former satellite (e.g. `### From #345 — <title>`), or a durable doc under `docs/` if the epic body would be huge.
3. Comment on each satellite with a pointer to the epic section (or doc path) + Goal, then **close** them (`not_planned` is fine for parked work).
4. Do **not** leave long open satellite issues, and do **not** put the Epic or satellites on the Product Project.

When delivery starts under an Adopted Goal, re-open or create Tasks from those epic sections — do not re-scatter open trackers until delivery starts. Goal Status stays **Adopted** until product marks **Fulfilled**.

Example: Goal [Product#14](https://github.com/WeGotWorkspace/Product/issues/14) + Epic #349 (former E2EE satellites #335–#348 absorbed).

## After filing

- Planning / specs: [plan-feature](../plan-feature/SKILL.md)
- Verify before handoff: [verify-issue](../verify-issue/SKILL.md) (Goal vs Task/Epic modes)
