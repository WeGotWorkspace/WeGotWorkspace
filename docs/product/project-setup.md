# Product roadmap Project

**Live project:** [Product roadmap](https://github.com/orgs/WeGotWorkspace/projects/1) (org `WeGotWorkspace`, project number **1**).

Setup is **done**: Status options configured; open `type:goal` issues (#378–#392) added with Status set.

## Status options

Exploring → Proposed → Accepted → Building → Shipped → Later

| Status | Goals |
|--------|-------|
| Shipped | #378 #379 #380 #381 #382 #383 #384 #386 #387 |
| Building | #385 #388 |
| Accepted | #389 #390 |
| Later | #391 #392 |

**Board filter (required hygiene):** `label:type:goal` — paste into the Project filter box so only Goals show. Child epics/tasks may reappear via parent/sub-issue linkage or workflow automation; remove them from the Project (do not close the issues). Optional fields: Area, Horizon (now/next/later).

**Do not** add Tasks, Epics, Chores, Bugs, or eng checklist [#313](https://github.com/WeGotWorkspace/wegotworkspace/issues/313) to this Project.

## Re-auth (if scopes lapse)

```bash
gh auth refresh -s project,read:project
```
