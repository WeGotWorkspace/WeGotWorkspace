# Contract parity

## Source of truth

1. `packages/api/openapi/openapi.json`
2. PHPUnit feature tests (authoritative at merge time)
3. Legacy runtime — **behavior reference only**, not copy-paste source

## Rules

- Same path, method, status code, JSON keys as contract
- Do not break `packages/apps` generated types until OpenAPI is intentionally versioned

## Not required

- Same class names, folders, static methods, or `*Kernel` patterns as legacy
- `DomainRouteService`-style mega-dispatcher

Implement parity by **tests passing**, not by wrapping old handlers.
