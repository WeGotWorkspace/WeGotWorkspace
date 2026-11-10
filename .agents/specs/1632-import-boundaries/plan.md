# Warn when frontend code imports in the wrong direction

Derived from [spec.md](./spec.md). One chunk, one pull request.

## Goal

Encode the layering of `packages/apps/src` as one warn-level lint rule with an allowlist, and give #1638 a per-edge count to work down. See spec.md.

## Budget

Technical debt milestone, night of 2026-11-10. Displaces nothing on the pioneer list: lint configuration and docs only, no runtime code.

## Non-goals

- Moving code (#1638), `error` level (#1642 follow-up), cycle detection.

## What exists

- Two warn-level direction rules from #1642 candidate 4: `libImportDirectionRule` and `crossPackageBlocks` over six `TWO_WAY_PAIRS`. `path: packages/apps/eslint.config.js:115`
- Lint on main `cdacba3da` before this change: 0 errors, 560 warnings, 389 of them from those two rules, in 212 files. `path: packages/apps/eslint.config.js:115`

  ```bash
  pnpm --filter @wgw/apps exec eslint "src/**/*.{ts,tsx}" -f json
  ```

- `scripts/**/*.test.mjs` runs in the Vitest unit project. `path: packages/apps/vitest.config.ts:59`
- `lint-staged` runs `eslint --fix` without `--max-warnings`, so warnings never fail a commit. `path: lint-staged.config.mjs:27`

## Considered

- `@typescript-eslint/no-restricted-imports` patterns per `files` block (main today): rejected, see spec "A local rule". Relative paths are matched by regex, not resolved.
- `eslint-plugin-boundaries` or `eslint-plugin-import-x` `no-restricted-paths`: rejected. A new dependency and a resolver setup for one rule that a 150-line local rule covers, and neither gives the report its from/to without parsing paths.
- `workspace-shell` and `workspace-app` as shell, as the issue lists them: rejected, see spec "Layer map".
- A count ratchet that fails CI when the total grows: left for the #1642 follow-up. Four import/export sessions work in parallel tonight; a new failing check now could block their merges for warnings that are not theirs.

## Affected packages

- packages/apps | .agents

## Dependencies

None. #1638 moves follow this pull request and each one records the `lint:boundaries` count.

## Open decisions

None — every choice for this work is made.

## Invariants

- Lint stays green: the rule is `warn`, so `eslint` exits 0. A wrong change turns a warning into an error and fails `apps-quality`. Proof: `cmd: pnpm --filter @wgw/apps run lint`
- The rule reports exactly the layer and allowlist violations and resolves alias and relative specifiers alike. A wrong change misses `../` imports or flags allowed ones. Proof: `path: packages/apps/scripts/eslint-import-boundaries.test.mjs` assertion `import-boundaries`
- The report total equals the rule's warning count in a normal lint run. Proof: `cmd: pnpm --filter @wgw/apps run lint:boundaries`
- Every allowlist entry is app package → app package and carries a reason. Proof: `path: packages/apps/scripts/eslint-import-boundaries.test.mjs` assertion `gives every allowlist entry a reason and a real direction`

## Chunks

### Chunk A: rule, report, docs

- **id:** `chunk-a-boundary-rule`
- **Skill:** apps-ui
- **Inputs:** the #1642 blocks to replace — `path: packages/apps/eslint.config.js:115`
- **Done when:** the four direction rules of #1632 warn; `lint:boundaries` prints the count per edge; the allowlist has reasons; `.agents/skills/apps-ui/import-boundaries.md` describes the layering and links the config; the first report is on #1632.
- **Verify with:** `pnpm --filter @wgw/apps run lint`, `pnpm --filter @wgw/apps run lint:boundaries`, `pnpm --filter @wgw/apps exec vitest run --project unit scripts/eslint-import-boundaries.test.mjs`
- **Parallel with:** none

## Test plan

- [ ] Vitest: layer map, specifier resolution, violation kinds, allowlist shape, RuleTester valid and invalid cases, report counting and two-way pairs.
- [ ] Full lint: 0 errors; report total equals the rule's warnings.
