# Multitask verifier subagents

Read-only cross-chunk review after parallel build chunks merge. Complements per-chunk `done-when` and parent [done-checklist.md](done-checklist.md) — does not replace them.

**Canonical multitask flow:** [multitask.md](multitask.md). **Review gate:** [code-review](../code-review/SKILL.md). **Issue AC:** [verify-issue](../verify-issue/SKILL.md) when work tracks a GitHub issue. **Smells:** [clean-code/smells.md](../clean-code/smells.md). **Policy vs CI:** [POLICY.md](../../POLICY.md).

## When to spawn a verifier

Spawn **one verifier subagent** after parallel build chunks finish and the parent has reconciled the working tree (merge conflicts resolved, plan todos updated). Skip verifiers for work that does not need cross-chunk review.

| Spawn verifier | Skip verifier |
|----------------|---------------|
| 2+ parallel **build** chunks touched the same feature or package | Single-chunk or sequential work |
| Full-stack feature (API contract + UI consumers) | Docs-only or mechanical rename |
| Shared contract changed (OpenAPI, `workspace-split-app.css`, operations DI types) | One independent pane with no shared files |
| Parent is unsure chunks integrated cleanly | Parent already ran full [done-checklist](done-checklist.md) on merged diff and found no cross-boundary risk |

**Lightweight rule:** If parallel agents only touched disjoint files with no shared inputs in the plan, a **quick parent pass** (smells on combined diff + targeted test commands) is enough — no subagent.

**Heavy rule:** If chunks shared **inputs**, **Parallel with** edges, or **sequential dependencies** (OpenAPI → typegen → UI), spawn a verifier before declaring done or opening a PR.

## Verifier vs other roles

| Role | Owner | When | Loads |
|------|-------|------|-------|
| **Builder** | chunk agent | During chunk | Domain skill + `clean-code` |
| **Hardening / verify chunk** | chunk or parent | After merge | `testing` — runs suites ([test-first.md](../testing/test-first.md)) |
| **Verifier subagent** | parent spawns | After merge, before handoff | `code-review` + this doc — **read-only**, no commits |
| **Parent** | orchestrator | Always | Reconciles plan; runs or delegates checklist commands |

Verifiers **report** blockers and nits; they do not fix code unless the user asks the parent to delegate fixes.

## Verifier checklist

Run in order. Link out for depth — do not duplicate domain skill content.

### 1. Cross-chunk consistency

- [ ] **Plan alignment** — each chunk's `done-when` met; no chunk left "parallel" work in shared files (grep overlapping paths from chunk handoffs).
- [ ] **Contract chain** — if OpenAPI changed: typegen run, apps types match new shapes, no UI still using old field names.
- [ ] **Naming & types** — same concept uses same names across chunks (props, operations, API resources, story titles).
- [ ] **No duplicate implementations** — one handler/mock path per boundary; no second copy of parsing, routing, or CSS that another chunk already owns.
- [ ] **Integration seams** — workspace shell wires new panes; exports public; no orphan components without workspace registration.
- [ ] **Merge hygiene** — no conflict markers; no accidental deletion of another chunk's files.

### 2. Smells scan (combined diff)

Follow [clean-code/smells.md](../clean-code/smells.md) on **all files touched by any chunk**, with extra attention at chunk boundaries (imports across packages, shared hooks, duplicated mock data).

**Hook structure (apps):**

- [ ] New/changed hooks meet React hooks thresholds in smells.md — or PR documents an approved exception.
- [ ] **Test-to-orchestrator ratio** — flag when a hook test file is much larger than the orchestrator's public surface (smell: behavior tested but structure untouchable). Prefer pure-module tests + thin hook contract tests ([ui-architecture.md](../testing/ui-architecture.md)).
- [ ] **Duplicate concerns** — flag new hooks that re-implement logic already owned by sibling modules in the same feature folder (e.g. second Yjs write path when `*-map-writes.ts` exists).

### 3. Policy vs CI

Follow [code-review](../code-review/SKILL.md) step 3 — [POLICY.md](../../POLICY.md). Flag **new** violations; note pre-existing debt without expanding scope.

### 4. Integration gaps

- [ ] **Untested boundaries** — API feature test covers new routes; UI Vitest covers new hooks/parsers; mock-tier stories cover new exports ([done-checklist](done-checklist.md)).
- [ ] **Cross-chunk test holes** — e.g. API chunk added field but no UI story/state uses it; UI chunk calls endpoint not in OpenAPI.
- [ ] **Storybook offline** — changed exports have mock-tier stories; `pnpm check:storybook-coverage` would not regress.
- [ ] **Operations DI** — panes use slice `operations`, not `@/lib/api/wgw/http` ([apps-ui/components.md](../apps-ui/components.md)).

### 5. Test coverage across chunks

Map plan chunk IDs → tests/stories/commands. Report gaps; suggest commands from [done-checklist](done-checklist.md) for parent to run.

| Package | Parent should run (verifier cites, does not skip parent) |
|---------|----------------------------------------------------------|
| API | `composer test -- --filter <Domain>`, `pnpm test:api-done-gate` |
| Apps | `pnpm --dir packages/apps test`, `pnpm check:storybook-coverage` |
| Full-stack | API rows + UI rows + merge order respected |

Verifier may run **read-only** inspection (`git diff`, `rg`, file reads). Running test commands is optional when the parent already attached CI output; otherwise run targeted commands and include pass/fail in the report.

## How to spawn (parent)

Use the host's subagent/task tool with **`readonly: true`** when available. One verifier per merged feature wave; split into two verifiers only if domains are independent (e.g. API-only vs apps-only) and diffs are large.

1. Merge or reconcile all build chunk branches into the working tree.
2. Copy the [prompt template](#prompt-template) below; fill placeholders from the plan.
3. Spawn verifier; wait for report.
4. Parent triages: fix blockers, re-run affected chunk or verifier, then run full [done-checklist](done-checklist.md).
5. If the feature tracks a GitHub issue, run [verify-issue](../verify-issue/SKILL.md) before handoff.
6. Optional second verifier pass after fixes if blockers touched shared contracts.

## Prompt template

```markdown
You are a **multitask verifier** for WeGotWorkspace. Read-only — do not edit files or commit.

## Context
- **Feature:** {{FEATURE_TITLE}}
- **Plan:** {{PLAN_PATH_OR_SUMMARY}}
- **Merged chunks:**

| ID | Summary | Key paths |
|----|---------|-----------|
| {{CHUNK_A_ID}} | {{CHUNK_A_SUMMARY}} | {{CHUNK_A_PATHS}} |
| {{CHUNK_B_ID}} | {{CHUNK_B_SUMMARY}} | {{CHUNK_B_PATHS}} |

- **Sequential dependencies:** {{E.G. OpenAPI → typegen → UI}}
- **Shared files risk:** {{LIST_OR_NONE}}

## Load first
1. `.agents/skills/developer/multitask-verifier.md` (this checklist)
2. `.agents/skills/code-review/SKILL.md`
3. `.agents/skills/clean-code/smells.md`
4. `.agents/skills/verify-issue/SKILL.md` when the feature tracks a GitHub issue
5. Domain skills only if relevant: {{api | apps-ui | workspace | storybook}}

## Your task
1. Inspect the **combined** diff for all chunks (`git diff`, `git status`, read boundary files).
2. Run the verifier checklist in `multitask-verifier.md` (verify-issue when applicable → cross-chunk → smells → policy → integration → tests).
3. Return a short report:

### Verdict
`PASS` | `PASS_WITH_NITS` | `BLOCK`

### Blockers
- …

### Nits
- …

### Suggested commands for parent
- …

### Chunk coverage map
| Chunk | Tests/stories found | Gap |
|-------|---------------------|-----|
| … | … | … |
```

## Example: three parallel UI chunks

**Feature:** Settings profile editor, drive search bar, and notes list filter — independent panes, no OpenAPI change, parallel safe per [multitask.md](multitask.md).

| Chunk | Skill | Key paths |
|-------|-------|-----------|
| `ui-settings-profile` | `workspace`, `apps-ui` | `packages/apps/src/settings-core/` |
| `ui-drive-search` | `workspace`, `apps-ui` | `packages/apps/src/drive-core/` |
| `ui-notes-list-filter` | `workspace`, `apps-ui` | `packages/apps/src/notes-core/` |

**Parent after merge:** reconcile todos → spawn one verifier (disjoint paths, but same package and shared workspace patterns).

**Example invocation (parent to subagent):**

```markdown
You are a **multitask verifier** for WeGotWorkspace. Read-only — do not edit files or commit.

## Context
- **Feature:** Independent pane UX improvements (settings profile, drive search, notes list filter)
- **Merged chunks:**

| ID | Summary | Key paths |
|----|---------|-----------|
| ui-settings-profile | Profile form validation + save affordance | `packages/apps/src/settings-core/` |
| ui-drive-search | Search utils + main pane query state | `packages/apps/src/drive-core/` |
| ui-notes-list-filter | List pane filter chips | `packages/apps/src/notes-core/` |

- **Sequential dependencies:** none (no OpenAPI)
- **Shared files risk:** low — verify no edits to `workspace-split-app.css` or shared `packages/apps/src/lib/` without coordination

## Load first
1. `.agents/skills/developer/multitask-verifier.md`
2. `.agents/skills/code-review/SKILL.md`
3. `.agents/skills/clean-code/smells.md`
4. `apps-ui`, `workspace`, `storybook` if stories changed

## Your task
Run the verifier checklist on the combined diff. Pay extra attention to:
- Consistent operations/mock patterns across the three cores
- Each changed export has mock-tier stories
- Vitest for new hooks (e.g. `use-settings-profile-form`, drive search utils)
- No accidental cross-imports between mail/drive/settings cores

Return verdict, blockers, nits, suggested commands (`pnpm --dir packages/apps test`, `pnpm check:storybook-coverage`), and chunk coverage map.
```

**Expected verifier output (illustrative):**

- **Verdict:** `PASS_WITH_NITS`
- **Blockers:** none if stories + Vitest exist per chunk
- **Nits:** mail filter chip CSS duplicates drive search chip styles — consider shared primitive later (do not expand scope now)
- **Suggested commands:** `pnpm --dir packages/apps test`, `pnpm check:storybook-coverage`
- **Coverage map:** three rows linking chunk ID → `*.test.ts(x)` + `*.stories.tsx` paths or gaps

## Example: full-stack two-chunk merge

**Feature:** New drive share API + drive share pane.

| Chunk | Parallel? | Depends on |
|-------|-----------|------------|
| `api-drive-share` | — | — |
| `ui-drive-share-pane` | after API + typegen | `api-drive-share` |

Spawn verifier **after** both merge. Checklist emphasis: OpenAPI ↔ feature tests ↔ generated types ↔ pane operations ↔ mock-tier stories. Verdict `BLOCK` if UI calls undocumented paths or API fields lack UI coverage in stories/tests.

## Plan integration

In [plan-feature](../plan-feature/SKILL.md) plans, add an optional final chunk:

```markdown
### Chunk V: Cross-chunk verify
- **Skill:** code-review (via multitask-verifier)
- **Inputs:** merged chunks A, B, C
- **Done when:** verifier report `PASS` or `PASS_WITH_NITS`; parent ran done-checklist commands
- **Verify with:** verifier prompt from [multitask-verifier.md](multitask-verifier.md)
- **Parallel with:** none
```

## Related updates

When verifier pattern changes, keep in sync: [multitask.md](multitask.md), [code-review/SKILL.md](../code-review/SKILL.md), [storybook/offline-first.md](../storybook/offline-first.md) multitask row.
