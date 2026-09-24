# Test-first workflow

This repo is **not** classic TDD everywhere today — but **new work** should follow the flows below so tests lead implementation, not trail it.

See [testing/SKILL.md](SKILL.md) for commands and done-when checklists.

## API — contract-first (recommended order)

Greenfield REST under `packages/api/`:

```text
OpenAPI change → failing feature test → implement → green → done gate
```

| Step | Action |
|------|--------|
| 1 | Edit `packages/api/openapi/openapi.json` (path, method, schemas, `x-wgw-access`) |
| 2 | Add or extend **`tests/Feature/{Domain}/...`** asserting status + JSON shape from OpenAPI |
| 3 | Run tests — expect **failure** (route/service missing) |
| 4 | Implement route → Form Request → Resource → Service ([api/layers.md](../api/layers.md)) |
| 5 | Run **`composer done-gate`** or domain tests until green |
| 6 | Regenerate types: `pnpm --filter @wgw/openapi-types typegen` when the contract changed |

**Red-green at the HTTP boundary:** the feature test is the executable spec; OpenAPI is the shared contract with the UI.

Do not implement behavior first and “add tests later.” Do not copy legacy handlers — [api/contract-parity.md](../api/contract-parity.md).

Optional after gate: `pnpm test:api-e2e:docker` (Playwright, local, not CI).

## UI — layer-appropriate test-first

| Layer | Test first with | Then implement |
|-------|-----------------|----------------|
| Pure util / parser | Vitest unit test | Function in `lib/` or `*-core` |
| Hook / controller logic | Vitest (+ RTL if needed) with **mock `operations`** | Hook implementation |
| Pane / composite UI | Mock-tier **Storybook story** (offline) + Vitest if logic-heavy | Component + variants |
| Critical user flow | Story **`play`** (target) or Vitest RTL on harness | Interaction wiring |

### UI rules

1. **Mock-tier Storybook first** for any new export — must run without live API ([storybook/offline-first.md](../storybook/offline-first.md)).
2. **Inject dependencies** — `operations` / slice handlers; never import `@/lib/api/wgw/http` in panes ([apps-ui/components.md](../apps-ui/components.md)).
3. **Vitest for logic** — state machines, mappers, hooks; co-locate `*.test.ts(x)` ([ui-architecture.md](ui-architecture.md)).
4. **Do not** rely on live API stories for development or CI — `Live …` stories are optional smoke only.

### UI red-green example (hook)

```tsx
// 1. Write failing test with stub operations
it("saveProfile calls operations.saveProfile", async () => {
  const saveProfile = vi.fn().mockResolvedValue(undefined);
  // render hook or pane with { profile: { saveProfile, … } }
  await userEvent.click(screen.getByRole("button", { name: /save/i }));
  expect(saveProfile).toHaveBeenCalled();
});

// 2. Implement until green
```

## Planning (multitask)

In [plan-feature](../plan-feature/SKILL.md) chunks, order:

1. **Red-green chunk** — OpenAPI + failing feature test (API) or mock-tier story (UI); same chunk or immediately before build; may run parallel with unrelated domains
2. **Build chunk** — implementation until red-green passes
3. **Verify chunk** — full suite + done gate after build chunks merge
4. **Cross-chunk verifier** (optional) — read-only subagent per [multitask-verifier.md](../developer/multitask-verifier.md) when 2+ build chunks or shared contracts

See [developer/multitask.md](../developer/multitask.md) for parallel vs sequential rules.

Chunk `done-when` must include **automated proof**, not “looks fine in browser.”

## What we do not require (yet)

Enforcement status for Storybook coverage, `play` functions, Vitest smoke, and e2e: [.agents/POLICY.md](../../POLICY.md). Apps measurable done criteria: [apps-done-gate.md](apps-done-gate.md). Coverage audit closed ([#72](https://github.com/WeGotWorkspace/wegotworkspace/issues/72) / [#76](https://github.com/WeGotWorkspace/wegotworkspace/pull/76)); expand `play` / WCAG / [Chromatic](../storybook/chromatic.md) over time.

## When to skip test-first

- Docs-only, CSS token tweak with no behavior change
- Mechanical rename with unchanged tests passing
- User explicitly scopes “no tests” (rare)

Even then, run affected suites before handoff.
