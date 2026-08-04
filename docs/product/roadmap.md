# Product roadmap

Capability map for WeGotWorkspace. Language is **user outcomes**, not protocols or package paths.

**Source of truth for Goals:** GitHub issues labeled [`type:goal`](https://github.com/WeGotWorkspace/wegotworkspace/issues?q=is%3Aissue+label%3Atype%3Agoal).  
**Product Project:** [Product roadmap](https://github.com/orgs/WeGotWorkspace/projects/1) — statuses Accepted → Building → Shipped; filter `label:type:goal` only. Setup notes: [project-setup.md](./project-setup.md).

**Community closed:** Idea intake and Goal proposals from outside maintainers are **not open** until the legal entity / CLA exists. Public Discussions Ideas may stay closed; maintainers still explore in Discussions and promote to Goals at **Accepted**. See [CONTRIBUTING.md](../../CONTRIBUTING.md).

Engineering milestones (`v0.9`, `v1.0`) pack **Epics/Tasks/Bugs** for a release train — **never** assign milestones to Goals. They are not the browsing UI for product intent.

## How to browse

Ready-to-click filters (full kit also in [README.md](./README.md)):

| Audience | View | Link |
|----------|------|------|
| Anyone | Goals only | [label:type:goal](https://github.com/WeGotWorkspace/wegotworkspace/issues?q=is%3Aissue+label%3Atype%3Agoal) |
| Anyone | Board — Building | [Product Project](https://github.com/orgs/WeGotWorkspace/projects/1) → filter `label:type:goal status:Building` |
| Anyone | Board — Accepted | filter `label:type:goal status:Accepted` |
| Maintainers | Open delivery (task/epic) | [type:task OR type:epic, not Goals](https://github.com/WeGotWorkspace/wegotworkspace/issues?q=is%3Aissue+is%3Aopen+-label%3Atype%3Agoal+%28label%3Atype%3Atask+OR+label%3Atype%3Aepic%29) |
| Maintainers | Bugs | [label:bug](https://github.com/WeGotWorkspace/wegotworkspace/issues?q=is%3Aissue+is%3Aopen+label%3Abug) |
| Maintainers | Chores | [label:type:chore](https://github.com/WeGotWorkspace/wegotworkspace/issues?q=is%3Aissue+is%3Aopen+label%3Atype%3Achore) |
| Maintainers | Eng packing v0.9 | [milestone:v0.9](https://github.com/WeGotWorkspace/wegotworkspace/issues?q=is%3Aissue+milestone%3Av0.9) |

If child Tasks/Epics reappear on the board (auto-add via parent linkage), keep the board filter `label:type:goal` and remove non-Goals from the Project.

---

## Shipped

| Goal | Issue | Areas |
|------|-------|--------|
| Run a self-hosted office on my own server | [#378](https://github.com/WeGotWorkspace/wegotworkspace/issues/378) | platform, admin |
| Manage files in Drive (browse, upload, offline) | [#379](https://github.com/WeGotWorkspace/wegotworkspace/issues/379) | drive |
| Write and edit Docs and Notes | [#380](https://github.com/WeGotWorkspace/wegotworkspace/issues/380) | docs, notes |
| Work on Docs and personal Notes offline | [#381](https://github.com/WeGotWorkspace/wegotworkspace/issues/381) | docs, notes, platform |
| Send and receive Mail | [#382](https://github.com/WeGotWorkspace/wegotworkspace/issues/382) | mail |
| Manage Contacts | [#383](https://github.com/WeGotWorkspace/wegotworkspace/issues/383) | platform |
| Keep a personal to-do list with due dates and optional reminders | [#384](https://github.com/WeGotWorkspace/wegotworkspace/issues/384) | tasks |
| Manage users on my instance | [#386](https://github.com/WeGotWorkspace/wegotworkspace/issues/386) | admin |
| Install suite apps as PWAs | [#387](https://github.com/WeGotWorkspace/wegotworkspace/issues/387) | platform |

Project status **Shipped** is set on these Goals in the [Product roadmap](https://github.com/orgs/WeGotWorkspace/projects/1) Project.

## Building

| Goal | Issue | Areas | Notes |
|------|-------|--------|--------|
| Manage calendars, events, and sharing in the browser | [#385](https://github.com/WeGotWorkspace/wegotworkspace/issues/385) | calendar | Browser Calendar (suite UX + live API); CalDAV given via Sabre; eng parity #137 |
| Share Docs and Drive files with guests via a link | [#388](https://github.com/WeGotWorkspace/wegotworkspace/issues/388) | docs, drive | Must-have for v0.9 |

## Accepted / Next

| Goal | Issue | Areas |
|------|-------|--------|
| Recover my password without an admin | [#389](https://github.com/WeGotWorkspace/wegotworkspace/issues/389) | admin, platform |
| Get notified about events and tasks while using the app | [#390](https://github.com/WeGotWorkspace/wegotworkspace/issues/390) | calendar, tasks, platform |
| Keep files, notes, and docs private with a zero-knowledge vault | [#391](https://github.com/WeGotWorkspace/wegotworkspace/issues/391) | drive, docs, notes, platform |
| Get help running the instance with AI-assisted operations | [#392](https://github.com/WeGotWorkspace/wegotworkspace/issues/392) | platform |
| Sign in with my organization's identity provider (OIDC SSO) | [#395](https://github.com/WeGotWorkspace/wegotworkspace/issues/395) | admin, platform |

---

## How statuses work

| Status | Meaning |
|--------|---------|
| Accepted | Committed product intent; delivery may not have started (far-horizon Goals stay here). |
| Building | Active child epics/tasks |
| Shipped | Success signals met for the intended slice |

**Intake (maintainers):** explore under GitHub Discussions (Ideas) → promote to a Goal issue with Status **Accepted**. Do not use Exploring/Proposed on the board.

Parked delivery under an Accepted Goal: keep the Goal on the board plus **one Epic** holding absorbed plans — see [issue-filing parked work](../../.agents/skills/developer/issue-filing.md#parked--far-horizon-work).

## Related

- [Product README](./README.md) — three-surface model
- [GOVERNANCE.md](../../GOVERNANCE.md)
- Eng release packing: [milestone:v0.9](https://github.com/WeGotWorkspace/wegotworkspace/issues?q=is%3Aissue+milestone%3Av0.9) (not a product SoT; former mega-checklist [#313](https://github.com/WeGotWorkspace/wegotworkspace/issues/313) closed)
