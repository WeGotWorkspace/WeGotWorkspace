# Product roadmap Project

**Live project:** [Product roadmap](https://github.com/orgs/WeGotWorkspace/projects/1) (org `WeGotWorkspace`, project number **1**). Visibility: **public**.

Setup is **done**: Status options configured; every Goal in [WeGotWorkspace/Product](https://github.com/WeGotWorkspace/Product) is on the board with Status set.

Goals moved from the code repository to the Product repository on 2026-10-26 (`transferIssue`). Project items, Status, labels, the `v0.9` milestone, and sub-issue links carried over, and old issue URLs redirect. Transferring a Goal makes **Auto-add sub-issues** re-add its delivery issues to the board; remove those items afterwards.

## Status options

Identified → Adopted → Fulfilled

| Status | Meaning |
|--------|---------|
| Identified | Recognized as a user goal (often after Discussion) |
| Adopted | Committed to pursue; Epics/Tasks may attach; **stays Adopted while building** |
| Fulfilled | Product judges outcome met — **not** auto from closed children |

Which Goals sit in which column is **only** on the [Product roadmap](https://github.com/orgs/WeGotWorkspace/projects/1) board — do not snapshot issue numbers here.

New Goals start as **Identified** (recognized) or **Adopted** (already committed). Eng progress lives on child Epics/Tasks — the Goal Status does **not** move to a separate “Building” column. Early research stays in Discussions — not on this board.

**Board filter (required hygiene):** `repo:WeGotWorkspace/Product` — views 1–3 use this. Goals have no kind label or issue type; the repository is what marks an issue as a Goal. Child epics/tasks/bugs may reappear via parent/sub-issue linkage or the built-in “Auto-add sub-issues” workflow; remove them from the Project (do not close the issues). Area is via `area:*` issue labels (visible on the board Labels field) — use `area:*` + milestone to group sibling Goals; **never** Goal→Goal parents. There is **no** Horizon / Now–Next–Later field — product progress is Status (`Identified` → `Adopted` until product marks `Fulfilled`); optional milestones are soft release targets only (≠ Fulfilled).

**Saved views:** [0.9 Roadmap](https://github.com/orgs/WeGotWorkspace/projects/1/views/4) is the beta todo (`status:Adopted milestone:v0.9`). Views 5–14 are the same filter plus one `area:*`. Browse kit: [README.md](./README.md#how-to-browse).

**Do not** add Tasks, Epics, Chores, or Bugs to this Project. Goals **may** carry a milestone as a soft release target (`v0.9` / `v1.0`); Status remains Identified → Adopted → Fulfilled (milestone ≠ Fulfilled). Milestones also pack delivery issues ([milestone:v0.9](https://github.com/WeGotWorkspace/wegotworkspace/issues?q=is%3Aissue+milestone%3Av0.9)).

## Auto-add Goals (built-in workflow)

Every issue in WeGotWorkspace/Product is a Goal. Configure the Project so those issues are added to this board automatically. **Do not** auto-add epics, tasks, chores, or bugs.

### API note

GitHub Projects V2 exposes some workflows via GraphQL (`projectV2.workflows`, `deleteProjectV2Workflow`), but **“Auto-add to project” is UI-only**: it is not returned by the API and cannot be created, filtered, or enabled via `gh` / GraphQL. Configure it in the UI below. Existing matching issues are **not** backfilled when the workflow is turned on — add them once with `addProjectV2ItemById` (all current Goals are already on the board).

### Exact UI clicks

1. Open [Product roadmap](https://github.com/orgs/WeGotWorkspace/projects/1).
2. Click the **⋯** (project menu) → **Workflows** (or open the **Workflows** tab if shown in the project sidebar).
3. Under **Default workflows**, open **Auto-add to project** (or a duplicate you created for Goals).
4. Click **Edit**.
5. Under **Filters**:
   - Repository: `WeGotWorkspace/Product`
   - Filter: `is:issue`
6. Click **Save and turn on workflow**.

Confirm the workflow shows as **On**. New / updated issues matching that filter are added going forward.

### What not to enable for this Project

| Workflow | Desired | Why |
|----------|---------|-----|
| **Auto-add to project** (repository `WeGotWorkspace/Product`, `is:issue`) | **On** | Goals only |
| **Auto-add sub-issues to project** | Prefer **Off** | Would pull child epics/tasks onto the product board |
| An auto-add workflow on `WeGotWorkspace/WeGotWorkspace` | Never | Would add delivery issues |

If “Auto-add sub-issues” is already on, turn it **off** in the same Workflows list so delivery issues do not keep reappearing. Keep the board filter `repo:WeGotWorkspace/Product` as hygiene either way.

### One-shot backfill (already done for current Goals)

```bash
# Example: add a missing Goal by node id
gh api graphql -f query='
mutation($project:ID!, $content:ID!) {
  addProjectV2ItemById(input: { projectId: $project, contentId: $content }) {
    item { id }
  }
}' -f project=PVT_kwDOETzKWc4BfVtL -f content=ISSUE_NODE_ID
```

List Goals: `gh issue list --repo WeGotWorkspace/Product --state all`.

## Re-auth (if scopes lapse)

```bash
gh auth refresh -s project,read:project
```
