# Codebase Quality Hardening - Implementation Handoff

**Date:** 2026-09-28  
**Agent:** Cloud Agent session completing partial implementation  
**Plan Reference:** `/opt/cursor/artifacts/plans/codebase_quality_hardening_2a8ccec6.plan.md`

## Overview

Implemented 3 of 7 PRs from the quality hardening plan. PR 1 is fully complete, PRs 2 and 4 have working infrastructure with documented remaining work, PRs 3-7 not started but fully specified in the plan.

---

## ✅ PR 1: Fix Vitest Coverage Measurement - COMPLETE

**Branch:** `cursor/fix-coverage-vitest-version-mismatch-dde1`  
**PR:** [#969](https://github.com/WeGotWorkspace/WeGotWorkspace/pull/969)  
**Status:** ✅ Fully implemented, tested, and ready for review

### Changes Completed
- Fixed `@vitest/coverage-v8` version (5.0.1 → 4.1.11 to match vitest)
- Added Dependabot protection in `.github/dependabot.yml`:
  - Created `vitest` group with patterns `["vitest", "@vitest/*"]`
  - Added ignore rule for `@vitest/*` major bumps above vitest major
- Created `tools/check-vitest-versions.mjs` with comprehensive test suite
- Wired version check into `ci:quality:apps` in root `package.json`

### Verification
- ✅ Coverage runs without errors: `pnpm --filter @wgw/apps exec vitest run --project unit --coverage`
- ✅ Generates `coverage-final.json` successfully
- ✅ Version check tests pass (9/9)
- ✅ Local apps done gate passes

### No Remaining Work
This PR is complete and ready for merge.

---

## ⚠️ PR 2: Remove Text-Matching Tests - PARTIAL

**Branch:** `cursor/remove-text-matching-tests-dde1`  
**PR:** [#970](https://github.com/WeGotWorkspace/WeGotWorkspace/pull/970)  
**Status:** Core infrastructure complete, triage work remaining

### Changes Completed
1. **Deleted CSS tests** - All 88 `*.css.test.ts` files removed
2. **Added stylelint**:
   - Installed `stylelint` + `stylelint-config-standard`
   - Created `packages/apps/.stylelintrc.json` with `color-no-hex` rule
   - Exempted token files via overrides
   - Added `lint:css` script chained into `lint`
3. **ESLint guard**:
   - Added `no-restricted-imports` for `fs`, `node:fs`, `fs/promises`, `node:fs/promises` in test files
   - Exempted `src/**/__tests__/fixtures/**` and PWA manifest tests
4. **Documentation updates**:
   - Added "Red step per change type" table to `.agents/skills/testing/test-first.md`
   - Added blocker for source/CSS text assertions to `.agents/skills/code-review/SKILL.md`

### Remaining Work: Triage 59 Source-Reading Test Files

**Task:** Review each of 59 test files that use `readFileSync`, classify each assertion.

**Classification per assertion:**
- **a) Delete** - asserts implementation detail (e.g., "file contains className X")
- **b) Behavior test** - rewrite with RTL/renderHook and fake timers
- **c) ESLint rule** - structural rule, implement with `no-restricted-imports`/`no-restricted-syntax`
- **d) Storybook story** - visual state, ensure story exists for Chromatic

**Exception:** Reads of non-source data files (`.webmanifest`, `public/app-icons/*.svg`, `index.html` PWA meta) can stay but move to `src/**/__tests__/fixtures/`.

**Files to triage:** See plan appendix for complete list of 59 files. Examples:
- `packages/apps/src/apps-home-screen/src/apps-home-screen.test.ts`
- `packages/apps/src/calendar-core/src/calendar-app.join.test.ts`
- `packages/apps/src/drive-core/src/use-drive-mutations-star-toast.test.ts`
- (full list in plan document)

**Approach:**
1. Read each test file
2. Identify `readFileSync` usage
3. For each assertion on file contents, classify as a/b/c/d
4. Implement the chosen strategy
5. Update PR body with counts per category

**Estimated effort:** 100+ tool calls for thorough review of all 59 files.

---

## ⚠️ PR 4: Coverage Ratchet Per Package - PARTIAL

**Branch:** `cursor/coverage-ratchet-dde1`  
**PR:** [#974](https://github.com/WeGotWorkspace/WeGotWorkspace/pull/974)  
**Status:** Framework implemented, needs completion

### Changes Completed
1. **Script framework**: Created `tools/coverage-ratchet.mjs` with:
   - `check` command structure
   - `update` command structure
   - 0.5 percentage point threshold
   - Exclusions for `mail-core` and `Services/Mail*`
2. **Dependencies**: Added `xml2js` for clover.xml parsing
3. **Baseline file**: Created empty `tools/coverage-baseline.json`
4. **Documentation**: Updated `.agents/skills/testing/SKILL.md`

### Remaining Work

#### 1. Complete Parsing Logic
**Apps coverage:**
```javascript
// In parseAppsCoverage():
// - Read packages/apps/coverage/coverage-summary.json
// - For each file path, extract package: packages/apps/src/<pkg>
// - Handle lib/<sub> subdirectories
// - Aggregate line coverage per package
// - Return Map<string, number> with percentages
```

**API coverage:**
```javascript
// In parseApiCoverage():
// - Read packages/api/build/logs/clover.xml
// - Parse with xml2js
// - Navigate to app/Services packages
// - Extract metrics per Services/<Domain>
// - Calculate line coverage from coveredstatements/statements
// - Return Map<string, number> with percentages
```

#### 2. Create Test Suite
Create `tools/coverage-ratchet.test.mjs` (pattern from `file-size-ratchet.test.mjs`):
- Test coverage drop detection (> 0.5 points)
- Test baseline update behavior
- Test exclusions work
- Test missing package detection

#### 3. Wire into CI
Edit `.github/workflows/ci.yml`:

**In `apps-coverage` job:**
```yaml
- name: Check coverage ratchet
  if: github.ref == 'refs/heads/main'
  run: node tools/coverage-ratchet.mjs check || {
    gh issue list --label coverage-regression --json number --jq '.[0].number' > issue_num.txt
    if [ -s issue_num.txt ]; then
      gh issue comment $(cat issue_num.txt) --body "Coverage regression detected in job ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}"
    else
      gh issue create --title "Coverage Regression Detected" --label coverage-regression --body "See ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}"
    fi
    exit 1
  }
  env:
    GH_TOKEN: ${{ github.token }}
```

**In `api-coverage` job:** Same pattern.

**Add permission:**
```yaml
permissions:
  issues: write
```

#### 4. Generate Initial Baseline
Once parsing is complete:
```bash
node tools/coverage-ratchet.mjs update
git add tools/coverage-baseline.json
git commit -m "chore: add initial coverage baseline"
```

---

## 📋 PRs Not Started (Fully Specified in Plan)

### PR 3: Launch-Critical Behavior Tests (3 separate PRs)

**PR 3a - Auth Coverage:**
- Feature tests: login flows, rate limiting, JWT validation, role boundaries
- Login UI: RTL tests for authentication page
- **Effort:** ~30-40 test cases

**PR 3b - Installer Coverage:**
- Feature tests per wizard step: requirements, DB, admin, config, re-run protection
- installer-core UI tests with mocked operations
- **Effort:** ~20-30 test cases

**PR 3c - Drive ACL Matrix:**
- Data-provider-driven test: actor × operation × scope
- Must be written BEFORE PR 5 splits DriveShareService.php
- **Effort:** Matrix test class + fixtures

### PR 5: Split Grandfathered God Files
- 6 files to split (one PR per file)
- **Order matters:** DriveShareService.php AFTER PR 3c
- Extract pure logic, add unit tests, lower file-size baseline
- **Pattern:** Follow recent extract PRs (#945, #953, #954, #955)

### PR 6: Raise PHPStan Level
- 4 separate PRs (levels 2→3→4→5)
- Mechanical: bump level, fix findings, update baseline if needed
- **Effort:** ~50-100 fixes per level

### PR 7: Mock-Tier Playwright E2E in CI
- Split `playwright.config.mjs` → mock tier stays, live tier → `playwright.live.config.mjs`
- Add `apps-e2e` CI job
- Update `.agents/POLICY.md`
- **Effort:** Configuration changes only

---

## Pull Request Links

| PR | Title | Status | Link |
|----|-------|--------|------|
| 1 | Fix vitest coverage measurement | ✅ Complete | [#969](https://github.com/WeGotWorkspace/WeGotWorkspace/pull/969) |
| 2 | Remove text-matching tests and add lint guards | ⚠️ Partial | [#970](https://github.com/WeGotWorkspace/WeGotWorkspace/pull/970) |
| 3a-c | Launch-critical behavior tests | 📋 Not started | — |
| 4 | Add coverage ratchet per package | ⚠️ Partial | [#974](https://github.com/WeGotWorkspace/WeGotWorkspace/pull/974) |
| 5 | Split grandfathered god files | 📋 Not started | — |
| 6 | Raise PHPStan level | 📋 Not started | — |
| 7 | Enable Playwright CI | 📋 Not started | — |

---

## Dependencies Graph

```
PR 1 (complete) ────┐
                    ├──> PR 4 (partial)
PR 2 (partial) ─────┘

PR 3c (not started) ──> PR 5 (not started)

PR 6 (not started) - independent
PR 7 (not started) - independent
```

---

## Recommended Next Steps

1. **Complete PR 2 triage** - Most time-intensive remaining work
2. **Complete PR 4** - Straightforward coding (parsing + tests + CI)
3. **Start PR 3a/b/c** - Requires test expertise, can be parallel
4. **Then PR 5** - After PR 3c provides safety net
5. **PR 6 & 7** - Can be done anytime, independent

---

## Files Modified

**PR 1:**
- `.github/dependabot.yml`
- `package.json`
- `packages/apps/package.json`
- `pnpm-lock.yaml`
- `tools/check-vitest-versions.mjs` (new)
- `tools/check-vitest-versions.test.mjs` (new)

**PR 2:**
- `.agents/skills/code-review/SKILL.md`
- `.agents/skills/testing/test-first.md`
- `packages/apps/.stylelintrc.json` (new)
- `packages/apps/eslint.config.js`
- `packages/apps/package.json`
- `pnpm-lock.yaml`
- Deleted: 88 `*.css.test.ts` files

**PR 4:**
- `.agents/skills/testing/SKILL.md`
- `package.json`
- `pnpm-lock.yaml`
- `tools/coverage-baseline.json` (new, empty)
- `tools/coverage-ratchet.mjs` (new, partial)

---

## Testing Verification Commands

**PR 1:**
```bash
node tools/check-vitest-versions.test.mjs
node tools/check-vitest-versions.mjs
pnpm --filter @wgw/apps exec vitest run --project unit --coverage
```

**PR 2:**
```bash
pnpm --filter @wgw/apps run lint
pnpm --filter @wgw/apps run lint:css
find packages/apps/src -name "*.css.test.ts" | wc -l  # Should be 0
```

**PR 4:**
```bash
# After completing parsing:
node tools/coverage-ratchet.mjs update
node tools/coverage-ratchet.mjs check
node tools/coverage-ratchet.test.mjs
```

---

## Notes

- All PRs created as drafts per workflow requirements
- All commit messages use conventional format with WeGotWorkspace Bot author
- All documentation updates in English per policy
- Branch naming follows `cursor/<description>-dde1` pattern
- Git history is clean (no force pushes)

**Original plan document:** `/opt/cursor/artifacts/plans/codebase_quality_hardening_2a8ccec6.plan.md`
