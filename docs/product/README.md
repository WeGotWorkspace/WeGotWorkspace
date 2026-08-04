# Product

Product intent for WeGotWorkspace lives here and on GitHub **Goal** issues (`type:goal`).

| Audience | Where |
|----------|--------|
| Anyone (later: community) | [roadmap.md](./roadmap.md), GitHub Goals + Product roadmap Project |
| Maintainers / eng | Epics, tasks, bugs; milestones `v0.9` / `v1.0`; [docs/architecture/](../architecture/) |

## Vision

Self-hosted autonomous office: Mail, Drive, Docs, Notes, Calendar, Tasks, Contacts, Meet, and admin — on infrastructure you control.

## How to browse

Use these filters instead of the default open-issue list (which mixes Goals with delivery trackers).

### Product (Goals)

| View | Link |
|------|------|
| Goals only (all states) | [issues?q=is:issue+label:type:goal](https://github.com/WeGotWorkspace/wegotworkspace/issues?q=is%3Aissue+label%3Atype%3Agoal) |
| Open Goals | [issues?q=is:issue+is:open+label:type:goal](https://github.com/WeGotWorkspace/wegotworkspace/issues?q=is%3Aissue+is%3Aopen+label%3Atype%3Agoal) |
| Product Project board | [Product roadmap](https://github.com/orgs/WeGotWorkspace/projects/1) — **board filter** `label:type:goal` (Goals only; Status columns = Exploring → … → Later) |
| Building | Board: open [Product roadmap](https://github.com/orgs/WeGotWorkspace/projects/1), filter `label:type:goal status:Building` |
| Accepted | Board filter `label:type:goal status:Accepted` |
| Later | Board filter `label:type:goal status:Later` |
| Shipped | Board filter `label:type:goal status:Shipped` |

Capability map (same Goals, table form): [roadmap.md](./roadmap.md). Project setup: [project-setup.md](./project-setup.md).

### Delivery (maintainers)

| View | Link |
|------|------|
| Open delivery (epic or task, not Goals) | [label:type:task OR label:type:epic, open](https://github.com/WeGotWorkspace/wegotworkspace/issues?q=is%3Aissue+is%3Aopen+-label%3Atype%3Agoal+%28label%3Atype%3Atask+OR+label%3Atype%3Aepic%29) |
| Bugs | [label:bug](https://github.com/WeGotWorkspace/wegotworkspace/issues?q=is%3Aissue+is%3Aopen+label%3Abug) |
| Chores / eng trackers | [label:type:chore](https://github.com/WeGotWorkspace/wegotworkspace/issues?q=is%3Aissue+is%3Aopen+label%3Atype%3Achore) |
| Needs triage | [label:needs-triage](https://github.com/WeGotWorkspace/wegotworkspace/issues?q=is%3Aissue+is%3Aopen+label%3Aneeds-triage) |
| Unlabeled open | [no:label](https://github.com/WeGotWorkspace/wegotworkspace/issues?q=is%3Aissue+is%3Aopen+no%3Alabel) |

**Do not** add Tasks, Epics, or Chores to the Product Project — Goals only. See [issue-filing.md](../../.agents/skills/developer/issue-filing.md).

Engineering release checklists (e.g. v0.9 milestone trackers) are **not** the product source of truth.

## Community

**Community proposals for Goals are not open yet** (legal entity / CLA pending). Maintainers create and accept Goals. See [GOVERNANCE.md](../../GOVERNANCE.md) and [CONTRIBUTING.md](../../CONTRIBUTING.md).

## Labels

| Kind | Label | On Product Project? |
|------|--------|---------------------|
| Goal | `type:goal` | Yes |
| Epic | `type:epic` | No |
| Task | `type:task` | No |
| Chore | `type:chore` | No |
| Bug | `bug` (+ `needs-triage`) | No |
| Area | `area:*` (mail, drive, docs, …) | Optional field / label |

Templates: [`.github/ISSUE_TEMPLATE/`](../../.github/ISSUE_TEMPLATE/) — `goal.yml`, `epic.yml`, `task.yml`, `chore.yml`, `bug-report.yml` (plus specialized `dast-finding.yml`). Blank issues are disabled. Community idea / Goal intake is **not open** — contact link points to [CONTRIBUTING.md](../../CONTRIBUTING.md); Discussions are not a public product hub yet.

The legacy `roadmap` label has been **removed**. Use `type:goal` + the Product roadmap Project for product outcomes.
