# Engineering tasks — RTC Phase 4 cross-window leader

Source spec: [spec.md](./spec.md)  
Source plan: [plan.md](./plan.md)

## Chunks

| id | owner / agent | skill | key paths | verify command | status |
|----|---------------|-------|-----------|----------------|--------|
| `principal-tab-sync` | builder | meet | `packages/apps/src/presence-core/src/principal-tab-sync.ts`, `principal-tab-sync.test.ts` | `pnpm --dir packages/apps exec vitest run src/presence-core/src/principal-tab-sync.test.ts` | done |
| `presence-leader-wire` | builder | meet | `presence-store.ts`, `presence-provider.tsx`, `follower-presence-session.ts` + tests | `pnpm --dir packages/apps exec vitest run src/presence-core` | done |
| `handoff-docs` | builder | document | `spec.md` go/no-go; `lib/rtc/README.md`; `000-rtc` pointer | docs review | done |

## Notes

- Branch: `feat/rtc-cross-window-leader` from `main` @ `44c033c99` (#690 merge).
- Body-hash for #695: `67649a17`.
- **Product ship gate (PWA / multi-window go/no-go) still open** on issue #695 AC — code implements the designed sticky leader; do not merge to `main` until product confirms N× dial pain (or records explicit “proceed” on the issue/spec).
- Collab principal-reuse in follower windows still falls back to per-room ICE (out of #695 scope).
