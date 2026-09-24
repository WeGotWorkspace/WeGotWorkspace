# TypeScript conventions (packages/apps)

## Strictness

- Project uses strict TypeScript — run `pnpm typecheck` in `packages/apps` before handoff.
- Prefer explicit return types on **exported** functions and hooks.
- Avoid `any`; if unavoidable, comment why and narrow ASAP.

## Imports

- `import type { … }` for type-only imports.
- Path alias: `@/` → `packages/apps/src/` (see `tsconfig.json`).
- OpenAPI-generated types: `@wgw/openapi-types/*` — **do not hand-edit** generated files.

## API types

- Shapes from OpenAPI: `packages/apps/src/lib/api/wgw/types.ts` re-exports generated types.
- Form schemas: Zod + `react-hook-form` with generated OpenAPI Zod where available (see `settings-profile-form-schema.ts`).

## React

- Function components with typed props interfaces or `type Props = { … }`.
- Discriminated unions for variant props when branches differ significantly.
- Hooks: prefix `use`; return typed objects; avoid leaking unstable inline objects when they trigger effect churn.

## Naming

- PascalCase components; camelCase functions/variables.
- Match existing feature module naming (`settings-core`, `use-settings-controller`).

## Co-location

- Types next to feature modules unless shared across products (`lib/api/wgw`, `@/ui`).
- Test files: `*.test.ts(x)` beside source ([testing/ui-architecture.md](../testing/ui-architecture.md)).

## Clean code overlap

Naming and function size: [clean-code](../clean-code/SKILL.md).

## Promote to top-level skill when

This file exceeds ~80 lines or conventions span packages beyond `apps` — then extract `typescript/` skill.
