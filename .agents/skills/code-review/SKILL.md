---
name: code-review
description: PR and handoff review checklist — issue acceptance criteria, smells scan, policy vs CI, done-checklist verification. Use when reviewing diffs, preparing merge-ready work, or asked to code-review.
---

# Code review

Lightweight gate before handoff or PR — not a second copy of domain skills.

## Order

0. **Issue-linked work:** [verify-issue](../verify-issue/SKILL.md) — Goal vs Task/Epic mode, spec body-hash drift (`SYNC OK` or re-sync), then acceptance criteria report (`ISSUE_SATISFIED` or documented partial) before technical gates below. `feat/` must not close a Goal as the sole `fixes #` issue.
0b. **Technical scope:** when `.agents/specs/<N>-*/spec.md` exists, confirm implementation matches spec goal, non-goals, affected packages, and edge cases — **AC still comes from the issue**, not spec.
0c. **Plan proof:** when `plan.md` exists, run the plan checks in [verify-issue](../verify-issue/SKILL.md) (Invariants `None` against this diff, test-file grep or command read per invariant row, cited source supports each What exists / Inputs claim). Do not cite `tasks.md` status or a chunk status line.
0d. **Security:** when the diff adds or changes a pre-auth path, an upload or parser of caller-supplied input, or a cache or limiter key derived from caller input, the [security](../security/SKILL.md) checklist is answered in the handoff. Unanswered is a block.
1. **[clean-code/smells.md](../clean-code/smells.md)** — scan touched files (required).
2. **[developer/done-checklist.md](../developer/done-checklist.md)** — run commands for packages you changed.
3. **[POLICY.md](../../POLICY.md)** — new work must meet policy rows; do not treat baseline/backlog gaps as excuses for new violations.
4. **[git-workflow](../git-workflow/SKILL.md)** — no commits or PRs unless the user asked; signed commits on `main`.

## Domain depth (load when relevant)

| Area | Skill |
|------|-------|
| API / OpenAPI / layers | [api](../api/SKILL.md) |
| UI / operations DI / CSS | [apps-ui](../apps-ui/SKILL.md), [workspace](../workspace/SKILL.md) |
| Stories / coverage | [storybook](../storybook/SKILL.md) |
| Tests / red-green | [testing](../testing/SKILL.md) |
| Pre-auth, caller-input parsers, limiter keys | [security](../security/SKILL.md) |

## Blockers vs nits

- **Block:** spec drift unresolved (`DRIFT:` from [verify-issue](../verify-issue/SKILL.md)), unmet issue acceptance criteria, implementation outside spec non-goals, policy violation in new code, missing tests for new behavior, secrets, legacy API PHP, live HTTP in panes, Dutch prose in specs/plans/docs or in GitHub text the agent wrote ([english-only.md](../developer/english-only.md)).
- **Block (plan proof):** Invariants `None` on a diff that leaves `docs/` and `.agents/`; an invariant row whose test file or assertion is missing on the PR tip; a What exists or Inputs claim whose citation does not support it; a security checklist left unanswered on a pre-auth path, a caller-input parser or upload, or a caller-derived cache or limiter key.
- **Block (test order, review only):** new behavior or a bugfix whose test commit does not precede the fix commit. Check `git log`. Not a CI gate.
- **Block (file size):** A new counted source file over 800 lines is a merge block unless its baseline entry carries an approved reason. A baselined file is a merge block when its line count grows, or when it shrinks and the stored integer was not lowered. A change to `tools/file-size-baseline.tsv` needs code-owner review; `check-growth` warns when a count rises or a row is added, and that warning is the signal (not a label bypass). See [clean-code/smells.md](../clean-code/smells.md).
- **Block (apps hooks):** structural smells in **new or changed** hook files per [clean-code/smells.md](../clean-code/smells.md) React hooks section:
  - Hook body > ~200 lines, or > 4 `useEffect`s, or > 2 unrelated concerns (Yjs, TipTap, DOM, draft UI, etc.) → must split or document an exception in the PR/handoff (link a follow-up issue only with explicit user approval).
  - State + ref mirror for the same value without an explanatory comment → refactor before handoff.
  - High test count or line coverage **does not** excuse unmaintainable structure — flag and block until split or exception documented.
  - Collab/text-editor hooks: expected layout in [workspace/collab-hooks.md](../workspace/collab-hooks.md).
- **Nit:** pre-existing debt outside the diff — note or link an issue; do not expand scope.

## Multitask merges

After parallel chunks:

1. Parent spawns a read-only **verifier subagent** when [multitask-verifier.md](../developer/multitask-verifier.md) applies (shared contracts, 2+ build chunks, full-stack).
2. Parent runs full [done-checklist](../developer/done-checklist.md) commands.
3. This skill's order (verify-issue when applicable → smells → done-checklist → policy) is the verifier's script — do not duplicate checklists in verifier prompts; link to those docs.
