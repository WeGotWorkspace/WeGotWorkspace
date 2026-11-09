# Clean Architecture (guardrails)

Applies across packages. **API-specific layering:** [api/layers.md](../api/layers.md).

## Dependency rule

Source code dependencies point **inward**:

- Domain / use-case logic must not depend on HTTP, UI, database drivers, or framework details.
- Adapters live at the edges (controllers, resources, React components, Eloquent models as persistence adapters).

## Policy vs detail

- **Policy:** business rules, validation intent, orchestration — belongs in services / domain modules.
- **Detail:** delivery mechanism (JSON shape, React tree, SQL) — belongs at boundaries.

## Boundaries

- Define interfaces at boundaries; inject dependencies.
- Keep use cases testable without booting the full framework where practical.

## In this monorepo

| Package | Inward (policy) | Outward (details) |
|---------|-----------------|-------------------|
| `packages/api` | `app/Services/{Domain}/` | Controllers, Resources, Eloquent models |
| `packages/apps` | Controller hooks, pure lib modules | TSX presentation, API client adapters |

Calendar is a React app (`calendar-core/`) around vendored Lit views (`lib/calendar-elements/`). That split is accepted until a single React rewrite: pull tokens and domain logic outward, leave the Lit internals alone. See [docs/architecture/calendar-react-lit.md](../../../docs/architecture/calendar-react-lit.md).

Do not reintroduce legacy static kernels or `\PDO` in domain services — see `api/SKILL.md` forbidden list.
