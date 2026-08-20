# Engineering tasks — Contacts app → JMAP

Source spec: [spec.md](./spec.md)
Source plan: [plan.md](./plan.md)

## Chunks

| id | owner / agent | skill | key paths | verify command | status |
|----|---------------|-------|-----------|----------------|--------|
| `jmap-contacts-app` | builder | workspace | `packages/apps/src/lib/jmap-client/contacts/`, `packages/apps/src/lib/api/wgw/contacts*.ts`, `packages/apps/src/contacts-core/src/use-contact-photo-src.ts` | `pnpm test:apps-done-gate` | done |

## Notes

- Chunk `id` matches the worktree / plan todo.
- Source is ad-hoc; do not file GitHub issues from this chunk.
