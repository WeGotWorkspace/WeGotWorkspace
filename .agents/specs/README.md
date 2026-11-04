# Spec-first workflow

Committed specs under `.agents/specs/` are the **technical implementation layer** beneath GitHub delivery issues. They do not replace Goals or issues — they translate **Task/Epic** AC for agents and parallel work.

## Layers — no competing truth

| Layer | Where | Role | Spec `Source:`? |
|-------|-------|------|-----------------|
| **Goal** (`type:goal`) | [WeGotWorkspace/Product](https://github.com/WeGotWorkspace/Product) + [docs/product/](../../docs/product/) | User **outcome**, success signals, non-goals — Product roadmap | **Never** |
| **Issue (AC)** — Epic / Task | GitHub | Implementable **what** — AC checklist, labels, PR linking | **Yes** — `Source: #<task-or-epic>` |
| **Specs** (`spec.md` → `plan.md` → `tasks.md`) | Repo | Technical **translation** + chunk split / eng rows — derived from the Task/Epic when implementation starts | Derived from Source |

```text
Goal (outcome) → Epic/Task (AC) → spec.md → plan.md → tasks.md
```

Optional header line (not hashed): `Goal: #M` for product context only.

Humans can keep working from GitHub issues alone. Specs are optional infrastructure for agent-driven implementation — required on `feat/` branches and for feature design on any branch (see below). Product Goals: [GOVERNANCE.md](../../GOVERNANCE.md). Filing: [developer/issue-filing.md](../skills/developer/issue-filing.md).

**Language:** `spec.md`, `plan.md`, and `tasks.md` are **English** even when the user prompt is Dutch. Same for the Source issue. [english-only.md](../skills/developer/english-only.md).

## Folder convention

Map name: **`<issue-number>-<slug>`**

```text
.agents/specs/134-drive-share/
  spec.md
  plan.md
  tasks.md
```

- Branch `feat/drive-share` + issue `#134` → `.agents/specs/134-drive-share/`
- No issue (rare): `.agents/specs/000-ad-hoc-slug/` with `Source: ad-hoc` in `spec.md`

Copy skeletons from [`_template/`](./_template/).

## When a spec is required

| Work | Spec required? |
|------|----------------|
| `feat/` branch (new user-facing feature) | **Yes** — with issue: derive from issue; without issue: `Source: ad-hoc` |
| Feature design on **any** branch, `docs/` included: designing a feature, a design note, or a new `docs/architecture/*.md` for an Epic | **Yes** — load [plan-feature](../skills/plan-feature/SKILL.md); add `<epic>-<slug>/` (spec, plan, tasks) in the same PR |
| Other `fix/`, `chore/`, `refactor/`, `docs/`, `test/` work | **No** — optional |
| Single-file fix (any prefix) | **No** — avoid bureaucracy on trivia |

Design review history and rejected alternatives go in `plan.md` under **Considered**. The architecture doc states the design as decided and links its spec folder.

**CI guard:** `pnpm run check:agent-docs` runs [`tools/check-architecture-spec.mjs`](../../tools/check-architecture-spec.mjs). When the diff adds a `docs/architecture/*.md` that names an Epic (`Epic: #N`, `Epic #N`, or a linked `Epic [#N]`), `.agents/specs/N-<slug>/spec.md` must exist and start with `Source: #N (body-hash: …)`. The first Epic the doc names is its Epic. Only docs the diff adds are checked; docs already on `main` are not.

## File roles

| File | Contents | Do not |
|------|----------|--------|
| `spec.md` | `Source: #134 (body-hash: a1b2c3d4)` header (Task/Epic only), optional `Goal: WeGotWorkspace/Product#M`, goal, non-goals, packages, constraints, edge cases | Use a Goal as `Source:`; re-invent AC or duplicate the full issue body |
| `plan.md` | Chunks, invariants, open decisions, what exists, budget, considered alternatives | Cite a premise without a source; leave a chunk choice open |
| `tasks.md` | Per-chunk engineering tasks: chunk-id, owner, key paths, verify command | Copy the GitHub `- [ ]` AC checklist; record completion status |

### Issue checklist vs `tasks.md`

- **Issue** (`- [ ]` in GitHub): human-visible acceptance criteria — update there on scope change
- **`tasks.md`**: which agent/chunk does which technical piece, in what order — for multitask and worktree scripts

On scope change: **update the issue first**, then re-sync `spec.md` / `plan.md` / `tasks.md`. Never change specs alone without updating the issue.

## Body-hash drift detection

The first line of `spec.md` records a hash of the issue body at generation time:

```text
Source: #134 (body-hash: a1b2c3d4)
```

Use **body content**, not `issue.updatedAt` — metadata changes (labels, assignees, comments) must not trigger false drift.

**Generate hash** (when creating or re-syncing spec):

```bash
gh issue view <N> --json body --jq .body | shasum -a 256
# Use first 8 hex chars in spec.md line 1
```

**Check drift** (handoff / verify-issue):

```bash
# Current body hash
gh issue view <N> --json body --jq .body | shasum -a 256

# Stored hash from spec header
grep '^Source:' .agents/specs/<N>-<slug>/spec.md
```

**Interpretation:**

| Condition | Result |
|-----------|--------|
| No `spec.md` on `feat/` work | `DRIFT: spec missing` |
| Current body-hash (first 8 chars) ≠ hash in `Source:` line | `DRIFT: re-sync spec from issue` — read issue body, update spec/plan/tasks, new body-hash |
| Hashes match | `SYNC OK` |

Full workflow: [verify-issue/SKILL.md](../skills/verify-issue/SKILL.md).

## Archive rule

A spec folder moves to `.agents/specs/archive/<year>/<N>-<slug>/` when **both** hold:

- its linked issue is closed (the `Source:` line of `spec.md`, else the folder number), and
- the folder has no commit in the last **60 days**.

`<year>` is the year of the folder's last commit. Archived specs are history: they keep their content and git history, `check-plan-structure` skips them, and nobody updates them. A spec that is still read as documentation (an architecture doc names it as the current design, say) should be refreshed instead, which also resets its age.

Specs stay in place when the rule cannot be applied safely:

- **Ad-hoc specs** (`Source: ad-hoc`) have no issue to close. Re-home them to an issue number, or leave them.
- **Held back:** a non-markdown file (a code comment, a script) mentions the folder name, or the `plan.md` of a spec that stays in place does. Rewriting that plan would put it through `check-plan-structure`, which an older plan may not pass. Fix the mention first, or archive both specs together.
- **Number does not resolve:** fix the `Source:` line first. When the number was a Goal that moved to [WeGotWorkspace/Product](https://github.com/WeGotWorkspace/Product), no Task exists: write `Source: ad-hoc` and put the Product issue on the `Goal:` line (a Goal is never `Source:`, see [File roles](#file-roles)). The spec is then ad-hoc and stays in place.

**Cadence:** [`doc-staleness.yml`](../../.github/workflows/doc-staleness.yml) runs on the first day of every month and posts the report as the job summary. Whoever picks up the report applies the rule in a `chore/` PR:

```bash
pnpm docs:staleness          # the report, as markdown
pnpm docs:archive-stale      # git mv every candidate, rewrite links that point into moved folders
pnpm run check:agent-docs    # links still resolve
```

[`tools/report-doc-staleness.mjs`](../../tools/report-doc-staleness.mjs) also lists every doc under `docs/` and `.agents/plans/` with no commit in 60 days. Those are reviewed by hand: refresh a doc that is still current, move a finished plan to `docs/archive/`.

## Related

- Planning: [plan-feature/SKILL.md](../skills/plan-feature/SKILL.md)
- Issue AC verification: [verify-issue/SKILL.md](../skills/verify-issue/SKILL.md)
- Parallel chunks: [developer/multitask.md](../skills/developer/multitask.md)
- Legacy plans: [`.agents/plans/`](../plans/) — older ad-hoc plans; new work uses this specs layout
