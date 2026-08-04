# Governance

How product intent and contributions are decided for WeGotWorkspace.

**Status:** Structure in place; **community participation is not open yet** (legal entity / CLA pending).

## Who accepts Goals

Only **maintainers** may create, accept, defer, or close product Goals (`type:goal`).

Lifecycle:

1. **Exploring** — research; may live as maintainer notes or a Goal in Exploring.
2. **Proposed** — Goal issue written (Outcome, Who it's for, Success looks like, Non-goals).
3. **Accepted** — maintainers commit to the outcome; child epics/tasks may start.
4. **Building** — active delivery under the Goal.
5. **Shipped** — success signals met for the intended slice.
6. **Later** — deferred without closing product intent.

Goals live on the **Product roadmap** Project (when configured). Engineering epics, tasks, bugs, and chores do **not**.

## Relationship to delivery

| Layer | Owns |
|-------|------|
| Goal | User outcome, success signals, non-goals, decisions |
| Epic / Task | Implementable acceptance criteria; milestones (`epic.yml` / `task.yml`) |
| Chore | Eng debt / trackers (`chore.yml`); no Goal required |
| Bug | Defects via bug template |

See [docs/product/README.md](docs/product/README.md).

## Future: community and CLA

When the legal entity and CLA exist, maintainers may:

- Open Discussions → Ideas as intake
- Promote accepted ideas to Goals
- Accept external code under the CLA

Until then: **no public Goal proposing, no external code contribution.** Bug reports may still be accepted per [CONTRIBUTING.md](CONTRIBUTING.md).

This document is not a substitute for a future RFC process; it is a stub so the model can open without another migration.
