# Spec-first workflow

Committed specs under `.agents/specs/` are the **technical implementation layer** beneath GitHub delivery issues. They do not replace Goals or issues — they translate **Task/Epic** AC for agents and parallel work.

## Three layers — no competing truth

| Layer | Where | Role | Spec `Source:`? |
|-------|-------|------|-----------------|
| **Goal** (`type:goal`) | GitHub + [docs/product/](../../docs/product/) | User **outcome**, success signals, non-goals — Product roadmap | **Never** |
| **Issue (AC)** — Epic / Task | GitHub | Implementable **what** — AC checklist, labels, PR linking | **Yes** — `Source: #<task-or-epic>` |
| **`spec.md`** | Repo | Technical **translation** derived from the Task/Epic when implementation starts | Derived from Source |
| **`plan.md`** / **`tasks.md`** | Repo | Chunk split / eng rows — **not** a copy of the issue checklist | — |

```text
Goal (outcome) → Epic/Task (AC) → spec.md → plan.md → tasks.md
```

Optional header line (not hashed): `Goal: #M` for product context only.

Humans can keep working from GitHub issues alone. Specs are optional infrastructure for agent-driven implementation — required only on `feat/` branches (see below). Product Goals: [GOVERNANCE.md](../../GOVERNANCE.md).

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

| Branch prefix | Spec required? |
|---------------|----------------|
| `feat/` (new user-facing feature) | **Yes** — with issue: derive from issue; without issue: `Source: ad-hoc` |
| `fix/`, `chore/`, `refactor/`, `docs/`, `test/` | **No** — optional |
| Single-file fix (any prefix) | **No** — avoid bureaucracy on trivia |

## File roles

| File | Contents | Do not |
|------|----------|--------|
| `spec.md` | `Source: #134 (body-hash: a1b2c3d4)` header (Task/Epic only), optional `Goal: #M`, goal, non-goals, packages, constraints, edge cases | Use a Goal as `Source:`; re-invent AC or duplicate the full issue body |
| `plan.md` | Chunks, dependencies, parallelization | — |
| `tasks.md` | Per-chunk engineering tasks: chunk-id, owner, key paths, verify command | Copy GitHub `- [ ]` AC checklist |

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

## Archive guidance

Completed specs on `main` **stay in place** as living documentation (Spec Kit / BMAD pattern). Do not delete merged feature specs.

When `.agents/specs/` grows large, consider (follow-up tooling, not required today):

- Move stale entries to `.agents/specs/archive/<year>/`
- Or group by year: `.agents/specs/2026/<N>-<slug>/`

No automatic archive script in v1 — manual moves when the directory becomes hard to navigate.

## Related

- Planning: [plan-feature/SKILL.md](../skills/plan-feature/SKILL.md)
- Issue AC verification: [verify-issue/SKILL.md](../skills/verify-issue/SKILL.md)
- Parallel chunks: [developer/multitask.md](../skills/developer/multitask.md)
- Legacy plans: [`.agents/plans/`](../plans/) — older ad-hoc plans; new work uses this specs layout
