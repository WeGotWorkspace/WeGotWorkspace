# Governance

How product intent and contributions are decided for WeGotWorkspace.

**Status:** Structure in place; **community participation is not open yet** (legal entity / CLA pending).

## Three surfaces

| Surface | Owns |
|---------|------|
| **Product** | Goals (`type:goal`) on the Product roadmap Project — user outcomes and Status |
| **Delivery** | Epics, Tasks, Bugs — implementable work under Goals |
| **Eng release packing** | GitHub milestones on Epics/Tasks/Bugs only (`v0.9`, `v1.0`, …) |

**Milestones never on Goals.** Far-horizon / not-yet-started intent stays Project Status `Accepted` (not a milestone, and not a competing mega-checklist issue). Details: [docs/product/README.md](docs/product/README.md#three-surfaces-systems-model).

## Who accepts Goals

Only **maintainers** may create, accept, defer, or close product Goals (`type:goal`).

Lifecycle (Product Project Status):

1. **Accepted** — maintainers commit to the outcome (new Goals start here, or **Building** if already in progress). Child epics/tasks may start; far-horizon Goals stay Accepted until Building.
2. **Building** — active delivery under the Goal.
3. **Shipped** — success signals met for the intended slice.

**Before Accepted:** maintainers explore under **GitHub Discussions** (Ideas). When ready, promote to a Goal issue and set Status to Accepted. Do not use Exploring/Proposed board columns.

Goals live on the **Product roadmap** Project (when configured). Engineering epics, tasks, bugs, and chores do **not**.

## Relationship to delivery

| Layer | Owns |
|-------|------|
| Goal | User outcome, success signals, non-goals, decisions (`goal.yml`); **no milestone** |
| Epic / Task | Implementable acceptance criteria; may take a milestone (`epic.yml` / `task.yml`) |
| Chore | Eng debt / trackers (`chore.yml`); no Goal required; not a product roadmap |
| Bug | Defects via `bug-report.yml` (`bug` label); may take a milestone |

See [docs/product/README.md](docs/product/README.md).

## Future: community and CLA

When the legal entity and CLA exist, maintainers may:

- Open Discussions → Ideas as **public** intake (aligned with blank_issues / CONTRIBUTING contact links)
- Promote accepted ideas to Goals at **Accepted**
- Accept external code under the CLA

Until then: **no public Goal proposing, no external code contribution.** Maintainers still use Discussion → Goal Accepted internally. Bug reports may still be accepted per [CONTRIBUTING.md](CONTRIBUTING.md).

This document is not a substitute for a future RFC process; it is a stub so the model can open without another migration.
