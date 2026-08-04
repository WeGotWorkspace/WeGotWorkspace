# Product

Product intent for WeGotWorkspace lives here and on GitHub **Goal** issues (`type:goal`).

| Audience | Where |
|----------|--------|
| Anyone (later: community) | [roadmap.md](./roadmap.md), GitHub Goals + Product roadmap Project |
| Maintainers / eng | Epics, tasks, bugs; milestones `v0.9` / `v1.0`; [docs/architecture/](../architecture/) |

## Vision

Self-hosted autonomous office: Mail, Drive, Docs, Notes, Calendar, Tasks, Contacts, Meet, and admin — on infrastructure you control.

## How to read the roadmap

1. Open [roadmap.md](./roadmap.md) for a capability map (Shipped / Building / Next / Later).
2. On GitHub, filter issues with label [`type:goal`](https://github.com/WeGotWorkspace/wegotworkspace/issues?q=is%3Aissue+label%3Atype%3Agoal).
3. Use the **[Product roadmap](https://github.com/orgs/WeGotWorkspace/projects/1)** Project (Statuses: Exploring → Proposed → Accepted → Building → Shipped → Later). Filter to Goals only. Notes: [project-setup.md](./project-setup.md).

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

The legacy `roadmap` label is **deprecated** for new work — prefer `type:goal` + Product Project.
