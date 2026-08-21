# Product

Product intent for WeGotWorkspace is **GitHub Goal issues** (`type:goal`) on the [Product roadmap](https://github.com/orgs/WeGotWorkspace/projects/1) Project. This folder is process only — not a second capability map.

| Audience | Where |
|----------|--------|
| Anyone | GitHub Goals (`type:goal`) + [Product roadmap](https://github.com/orgs/WeGotWorkspace/projects/1) Project; explore in [Discussions](https://github.com/WeGotWorkspace/wegotworkspace/discussions) |
| Maintainers / eng | Epics, tasks, bugs; milestones `v0.9` / `v1.0`; [docs/architecture/](../architecture/) |

## Vision

Self-hosted autonomous office: Mail, Drive, Docs, Notes, Calendar, Tasks, Contacts, Meet, and admin — on infrastructure you control.

## One outcome per Goal

Each Goal is **one fulfillable user outcome**. Split multi-outcome tickets into sibling Goals. Do **not** parent Goal→Goal — group with `area:*` and an optional shared milestone. Design language / suite consistency is a **Non-goal constraint** on Goals that need it, not its own Goal. Labels for Goals: `type:goal` + `area:*` (+ optional milestone). Details: [issue-filing.md](../../.agents/skills/developer/issue-filing.md#one-outcome-per-goal).

## Three surfaces (systems model)

Keep **three** surfaces — do not invent a fourth roadmap tracker:

| Surface | What | Browse |
|---------|------|--------|
| **1. Product** | Goals (`type:goal`) on the [Product roadmap](https://github.com/orgs/WeGotWorkspace/projects/1) Project | Status columns Identified → Adopted → Fulfilled |
| **2. Delivery** | Epics / Tasks / Bugs (`type:epic`, `type:task`, `bug`) — implementable work under Goals | Issue filters below; **not** on the Product Project |
| **3. Release targets & eng packing** | GitHub **milestones** (`v0.9`, `v1.0`, …) | Soft release target on Goals; pack Epics/Tasks/Bugs for a release train |

### Milestones on Goals (and delivery)

**Milestones may attach to Goals** as the soft release target for when we aim to fulfill the outcome. They are still OK on Epics/Tasks/Bugs (and optional eng chores) for eng packing.

- Goal Status remains **Identified → Adopted → Fulfilled** (product judgment on the board). **A milestone is not Fulfilled** — closing or hitting a milestone does not move Status.
- Soft release target → optional milestone on the Goal (e.g. `v0.9` / `v1.0`).
- Eng packing → milestone on delivery issues; filter e.g. [milestone:v0.9](https://github.com/WeGotWorkspace/wegotworkspace/issues?q=is%3Aissue+milestone%3Av0.9) (includes Goals targeting that release plus delivery work).
- Product “what’s in flight” → Goals on the board at **Adopted** (eng progress on child Epics/Tasks), not a mega checklist issue.
- Early research stays in **GitHub Discussions** (Ideas) until a maintainer promotes it to a Goal at **Identified** (then **Adopted** when committing) — do not use board columns for Exploring/Proposed.

The legacy `future` label on Goals is optional hygiene only — Status on the board is the source of truth; do not mass-retag.

See [GOVERNANCE.md](../../GOVERNANCE.md) and [issue-filing.md](../../.agents/skills/developer/issue-filing.md).

## How to browse

Use these filters instead of the default open-issue list (which mixes Goals with delivery trackers).

### Product (Goals)

| View | Link |
|------|------|
| Goals only (all states) | [issues?q=is:issue+label:type:goal](https://github.com/WeGotWorkspace/wegotworkspace/issues?q=is%3Aissue+label%3Atype%3Agoal) |
| Open Goals | [issues?q=is:issue+is:open+label:type:goal](https://github.com/WeGotWorkspace/wegotworkspace/issues?q=is%3Aissue+is%3Aopen+label%3Atype%3Agoal) |
| Product Project board | [Product roadmap](https://github.com/orgs/WeGotWorkspace/projects/1) — **board filter** `label:type:goal` (Goals only; Status = Identified → Adopted → Fulfilled) |
| Identified | Board: open [Product roadmap](https://github.com/orgs/WeGotWorkspace/projects/1), filter `label:type:goal status:Identified` |
| Adopted | Board filter `label:type:goal status:Adopted` |
| Fulfilled | Board filter `label:type:goal status:Fulfilled` |

Project setup (board workflows): [project-setup.md](./project-setup.md).

### Delivery (maintainers)

| View | Link |
|------|------|
| Open delivery (epic or task, not Goals) | [label:type:task OR label:type:epic, open](https://github.com/WeGotWorkspace/wegotworkspace/issues?q=is%3Aissue+is%3Aopen+-label%3Atype%3Agoal+%28label%3Atype%3Atask+OR+label%3Atype%3Aepic%29) |
| Bugs | [label:bug](https://github.com/WeGotWorkspace/wegotworkspace/issues?q=is%3Aissue+is%3Aopen+label%3Abug) |
| Chores / eng trackers | [label:type:chore](https://github.com/WeGotWorkspace/wegotworkspace/issues?q=is%3Aissue+is%3Aopen+label%3Atype%3Achore) |
| Milestone v0.9 (eng packing) | [milestone:v0.9](https://github.com/WeGotWorkspace/wegotworkspace/issues?q=is%3Aissue+milestone%3Av0.9) |
| Milestone v1.0 (eng packing) | [milestone:v1.0](https://github.com/WeGotWorkspace/wegotworkspace/issues?q=is%3Aissue+milestone%3Av1.0) |
| Needs triage | [label:needs-triage](https://github.com/WeGotWorkspace/wegotworkspace/issues?q=is%3Aissue+is%3Aopen+label%3Aneeds-triage) |
| Unlabeled open | [no:label](https://github.com/WeGotWorkspace/wegotworkspace/issues?q=is%3Aissue+is%3Aopen+no%3Alabel) |

**Do not** add Tasks, Epics, or Chores to the Product Project — Goals only. See [issue-filing.md](../../.agents/skills/developer/issue-filing.md).

**Parked / far-horizon delivery:** for **Adopted** Goals not yet in active delivery, keep the Goal on the board (`Adopted`) plus **one Epic** that holds the full plan (absorb satellite issue bodies into epic sections). Close long open satellites — do not leave a swarm of future-prefixed issues open. Details: [issue-filing.md — Parked / far-horizon work](../../.agents/skills/developer/issue-filing.md#parked--far-horizon-work).

Engineering release packing remains the **milestone filter** on delivery issues (and Goals that target that release) — not a product roadmap mega-checklist issue. Milestone ≠ Fulfilled.

## Community and maintainer intake

**Externals:** [Discussions](https://github.com/WeGotWorkspace/wegotworkspace/discussions) for ideas/exploration, plus Bug reports (and DAST where applicable). Blank issues are disabled. Goal / Epic / Task / Chore templates are **maintainers only** (enforced by workflow). See [CONTRIBUTING.md](../../CONTRIBUTING.md).

**Maintainer workflow:** explore under **GitHub Discussions** (anyone may start threads) → when ready, file a **Goal** issue at Product Project Status **Identified**, then **Adopted** when committing (or **Adopted** immediately if already committing). Do not put Exploring/Proposed on the board. See [GOVERNANCE.md](../../GOVERNANCE.md).

## Labels

| Kind | Label | On Product Project? | Milestone? |
|------|--------|---------------------|------------|
| Goal | `type:goal` + `area:*` | Yes | Yes (soft release target) |
| Epic | `type:epic` | No | Yes (release packing) |
| Task | `type:task` | No | Yes (release packing) |
| Chore | `type:chore` | No | Optional |
| Bug | `bug` (+ `needs-triage`) | No | Yes (release packing) |
| Area | `area:*` (mail, drive, docs, …) | On Goals (and optionally delivery) | Groups siblings; not a Goal parent |

Templates: [`.github/ISSUE_TEMPLATE/`](../../.github/ISSUE_TEMPLATE/) — `goal.yml`, `epic.yml`, `task.yml`, `chore.yml` (maintainers only), `bug-report.yml` (plus specialized `dast-finding.yml`). Blank issues are disabled. Externals use Discussions + bugs; maintainers promote Discussion → Goal **Identified** (then **Adopted** when committing).

The legacy `roadmap` label has been **removed**. Use `type:goal` + the Product roadmap Project for product outcomes.

The `offline` label has been **removed**. Do not recreate it. Group offline / hybrid-sync work with **Goals** (e.g. [#381](https://github.com/WeGotWorkspace/wegotworkspace/issues/381) Docs/Notes offline, [#400](https://github.com/WeGotWorkspace/wegotworkspace/issues/400) Mail offline) plus `area:*` on Goals and delivery issues — not a cross-cutting eng label.
