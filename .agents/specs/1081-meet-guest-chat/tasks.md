# Engineering tasks — live chat for guests in a Meet call

**Not** a copy of the GitHub issue acceptance checklist.

Source spec: [spec.md](./spec.md)  
Source plan: [plan.md](./plan.md)

## Chunks

| id | owner / agent | skill | key paths | verify command |
|----|---------------|-------|-----------|----------------|
| `meet-guest-chat` | builder | meet | `packages/apps/src/lib/rtc/session/meet-data-channel.ts`, `packages/apps/src/lib/rtc/session/meet-room-chat.ts`, `packages/apps/src/meet-core/src/meet-data-chat.ts` | `pnpm --dir packages/apps exec vitest run src/lib/rtc/session/meet-data-channel.test.ts src/lib/rtc/session/meet-room-chat.test.ts src/meet-core/src/meet-data-chat.test.ts src/meet-core/src/use-meet-mutations.test.tsx` |

## Notes

- Chunk id matches the worktree `meet-guest-chat`.
- Do not raise the file-size baseline.
