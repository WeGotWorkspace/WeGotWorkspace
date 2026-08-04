# Product roadmap Project

**Live project:** [Product roadmap](https://github.com/orgs/WeGotWorkspace/projects/1) (org `WeGotWorkspace`, project number **1**). Visibility: **public**.

Setup is **done**: Status options configured; open `type:goal` issues (#378–#392, #395, …) on the board with Status set.

## Status options

Exploring → Proposed → Accepted → Building → Shipped

| Status | Goals |
|--------|-------|
| Shipped | #378 #379 #380 #381 #382 #383 #384 #386 #387 |
| Building | #385 #388 |
| Accepted | #389 #390 #391 #392 |
| Exploring / Proposed | #395 (and new Goals as filed) |

**Board filter (required hygiene):** `label:type:goal` — paste into the Project filter box so only Goals show. Child epics/tasks may reappear via parent/sub-issue linkage or the built-in “Auto-add sub-issues” workflow; remove them from the Project (do not close the issues). Optional fields: Area, Horizon (now/next/later).

**Do not** add Tasks, Epics, Chores, or Bugs to this Project. **Do not** put milestones on Goals — milestones pack delivery issues only ([milestone:v0.9](https://github.com/WeGotWorkspace/wegotworkspace/issues?q=is%3Aissue+milestone%3Av0.9)).

## Auto-add Goals (built-in workflow)

New Goals filed via the **Goal** issue template auto-apply `type:goal`. Configure the Project so those issues are added to this board automatically. **Do not** auto-add epics, tasks, chores, or bugs.

### API note

GitHub Projects V2 exposes some workflows via GraphQL (`projectV2.workflows`, `deleteProjectV2Workflow`), but **“Auto-add to project” is UI-only**: it is not returned by the API and cannot be created, filtered, or enabled via `gh` / GraphQL. Configure it in the UI below. Existing matching issues are **not** backfilled when the workflow is turned on — add them once with `addProjectV2ItemById` (all current `type:goal` issues are already on the board).

### Exact UI clicks

1. Open [Product roadmap](https://github.com/orgs/WeGotWorkspace/projects/1).
2. Click the **⋯** (project menu) → **Workflows** (or open the **Workflows** tab if shown in the project sidebar).
3. Under **Default workflows**, open **Auto-add to project** (or a duplicate you created for Goals).
4. Click **Edit**.
5. Under **Filters**:
   - Repository: `WeGotWorkspace/wegotworkspace`
   - Filter: `is:issue label:type:goal`
6. Click **Save and turn on workflow**.

Confirm the workflow shows as **On**. New / updated issues matching that filter are added going forward.

### What not to enable for this Project

| Workflow | Desired | Why |
|----------|---------|-----|
| **Auto-add to project** (`is:issue label:type:goal`) | **On** | Goals only |
| **Auto-add sub-issues to project** | Prefer **Off** | Would pull child epics/tasks onto the product board |
| Filters that omit `label:type:goal` (e.g. bare `is:issue`) | Never | Would add all issue types |

If “Auto-add sub-issues” is already on, turn it **off** in the same Workflows list so delivery issues do not keep reappearing. Keep the board filter `label:type:goal` as hygiene either way.

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

List Goals: `gh issue list --repo WeGotWorkspace/wegotworkspace --label type:goal --state all`.

## Re-auth (if scopes lapse)

```bash
gh auth refresh -s project,read:project
```
