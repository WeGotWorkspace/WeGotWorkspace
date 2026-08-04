# Governance

How product intent and contributions are decided for WeGotWorkspace.

**Status:** Structure in place. **External intake** = Discussions (explore) + bug reports. Goals and delivery issues are maintainer-filed. External code PRs wait on the legal entity / CLA.

## Three surfaces

| Surface | Owns |
|---------|------|
| **Product** | Goals (`type:goal`) on the Product roadmap Project — user outcomes and Status |
| **Delivery** | Epics, Tasks, Bugs — implementable work under Goals |
| **Eng release packing** | GitHub milestones on Epics/Tasks/Bugs only (`v0.9`, `v1.0`, …) |

**Milestones never on Goals.** Far-horizon / not-yet-started intent stays Project Status `Identified` or `Adopted` (not a milestone, and not a competing mega-checklist issue). Details: [docs/product/README.md](docs/product/README.md#three-surfaces-systems-model).

## Who accepts Goals

Only **maintainers** may create, accept, defer, or close product Goals (`type:goal`).

Lifecycle (Product Project Status):

1. **Identified** — recognized as a user goal (often after Discussion). Not yet a delivery commitment.
2. **Adopted** — maintainers commit to pursue the outcome. Child Epics/Tasks may attach; **Status stays Adopted while building** (eng progress is on sub-issues, not a separate Goal column).
3. **Fulfilled** — product judges the outcome met for the intended slice (success signals). **Not** auto-set when all children close.

**Before Identified / Adopted:** anyone may explore under **GitHub Discussions**. When ready, **maintainers** promote a thread to a Goal issue at **Identified**, then move to **Adopted** when committing (or set **Adopted** immediately if already committing). Do not use Exploring/Proposed board columns.

Goals live on the **Product roadmap** Project (when configured). Engineering epics, tasks, bugs, and chores do **not**.

## Who may file which issues

| Actor | May file |
|-------|----------|
| External contributors | Discussions; Bug reports; DAST/security findings |
| Maintainers (`OWNER` / `MEMBER` / `COLLABORATOR`) | All templates (Goal, Epic, Task, Chore, Bug, DAST) |

Blank issues are disabled. A workflow closes Goal/Epic/Task/Chore issues opened by non-maintainers. See [CONTRIBUTING.md](CONTRIBUTING.md).

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

- Accept external code under the CLA
- Optionally refine Discussion → Goal promotion process (RFC, etc.)

Until then: **Discussions + bugs are open; no external Goal/Epic/Task/Chore filing; no external code contribution.** Maintainers promote Discussion → Goal **Identified** (then **Adopted** when committing).

This document is not a substitute for a future RFC process; it is a stub so the model can open without another migration.
