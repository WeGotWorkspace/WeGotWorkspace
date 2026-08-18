# Engineering tasks — Platform email delivery

**Not** a copy of the GitHub issue `- [ ]` acceptance checklist. This file tracks **which agent/chunk implements which technical piece** for multitask and worktree handoffs.

Source spec: [spec.md](./spec.md)  
Source plan: [plan.md](./plan.md)

Worktree: `feat/mail-delivery` at `../sabre-installer-mail-delivery` (`tools/worktree-agent.sh create mail-delivery`).

## Chunks

| id | owner / agent | skill | key paths | verify command | status |
|----|---------------|-------|-----------|----------------|--------|
| `mail-delivery-api` | builder | api | `packages/api/app/Services/MailDelivery/`, `SettingKeys`, OpenAPI admin state/settings/test-send | `pnpm test:api-done-gate` | done |
| `mail-delivery-admin-ui` | builder | workspace | `packages/apps/src/admin-core/` (new pane, not `admin-mail-pane.tsx`) | targeted Vitest / Storybook; later `pnpm test:apps-done-gate` | done |
| `mail-delivery-docs` | documenter | document | `packages/api/docs/mail-delivery.md` | AC docs bullets on #473 | done |

## Notes

- Chunk `id` values must match `plan.md` chunk IDs and multitask handoff names.
- A is sequential before B. C after A (docs from contract).
- On scope change: update **#473 first**, then re-sync spec/plan/tasks and the `Source:` body-hash in spec.md.
- Closing issue for `feat/`: **#473** (not Goal #471).
