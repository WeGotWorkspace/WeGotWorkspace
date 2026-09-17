# Engineering tasks — per-user IMAP/SMTP

Source spec: [spec.md](./spec.md)  
Source plan: [plan.md](./plan.md)

## Chunks

| id | owner / agent | skill | key paths | verify command | status |
|----|---------------|-------|-----------|----------------|--------|
| `chunk-s-per-user-servers` | builder | api, workspace | `packages/api/app/Services/Mail/`, Settings/Admin/installer panes, OpenAPI settings mail | `pnpm test:api-done-gate` | pending |
