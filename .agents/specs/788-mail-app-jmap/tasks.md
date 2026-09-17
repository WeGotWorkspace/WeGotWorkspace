# Engineering tasks — Mail app JMAP

Source spec: [spec.md](./spec.md)

## Chunks

| id | owner / agent | skill | key paths | verify command | status |
|----|---------------|-------|-----------|----------------|--------|
| `chunk-d-client` | builder | workspace | `packages/apps/src/lib/jmap-client/mail/` | Vitest | pending |
| `chunk-e-app` | builder | workspace | `mail-api-source.ts`, `lib/api/wgw/mail.ts` | `pnpm test:apps-done-gate` | pending |
