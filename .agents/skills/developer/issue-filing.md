# Issue filing checklist (Goal / Epic / Task / Chore / Bug)

Use when creating or classifying GitHub issues. Product intent: [docs/product/](../../../docs/product/), [GOVERNANCE.md](../../../GOVERNANCE.md). Delivery → specs: [plan-feature](../plan-feature/SKILL.md), [specs/README.md](../../specs/README.md).

## Checklist

1. **Classify:** Goal | Epic | Task | Chore | Bug
2. **Goal** → product language (Outcome / Who / Success looks like / Non-goals); label `type:goal`; add to [Product Project](https://github.com/orgs/WeGotWorkspace/projects/1); never sole `fixes #` / never `Source:` for `spec.md`
3. **Epic** → `type:epic`; **required** parent Goal; **not** on Product Project
4. **Task** → `type:task`; parent Epic or Goal; implementable `- [ ]` AC
5. **Chore / bug** → `type:chore` or `bug-report.yml` (`bug` label); no Goal required. Security/DAST: `dast-finding.yml`
6. Prefer templates under [`.github/ISSUE_TEMPLATE/`](../../../.github/ISSUE_TEMPLATE/) — [`goal.yml`](../../../.github/ISSUE_TEMPLATE/goal.yml), [`epic.yml`](../../../.github/ISSUE_TEMPLATE/epic.yml), [`task.yml`](../../../.github/ISSUE_TEMPLATE/task.yml), [`chore.yml`](../../../.github/ISSUE_TEMPLATE/chore.yml), [`bug-report.yml`](../../../.github/ISSUE_TEMPLATE/bug-report.yml) (or `gh issue create --template`). Specialized: [`dast-finding.yml`](../../../.github/ISSUE_TEMPLATE/dast-finding.yml)
7. `feat/` closes **Task/Epic**; `spec.md` `Source:` from that issue — **not** a Goal

## Quick matrix

| Kind | Label | Parent | Product Project? | Spec `Source:`? |
|------|-------|--------|------------------|-----------------|
| Goal | `type:goal` | — | Yes | Never |
| Epic | `type:epic` | Goal required | No | Yes (delivery) |
| Task | `type:task` | Epic or Goal | No | Yes (delivery) |
| Chore | `type:chore` | Optional | No | Usually no `feat/` |
| Bug | `bug` | Optional | No | Usually no `feat/` |

## After filing

- Planning / specs: [plan-feature](../plan-feature/SKILL.md)
- Verify before handoff: [verify-issue](../verify-issue/SKILL.md) (Goal vs Task/Epic modes)
