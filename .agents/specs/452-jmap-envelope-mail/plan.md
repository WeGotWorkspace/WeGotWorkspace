# JMAP Mail envelope — plan

Derived from [spec.md](./spec.md). Sequential: fixture + per-user servers → M1 → M2 (client library in parallel with M2).

## Chunks

### Chunk B: M1 read envelope

- **id:** `chunk-b-m1`
- **Skill:** api
- **Inputs:** #784, #785, decision doc, `/jmap/download`
- **Done when:** AC on #786
- **Verify with:** `composer done-gate`; `JmapMailClientContractTest`
- **Parallel with:** none

### Chunk C: M2 writes + Mailbox/set

- **id:** `chunk-c-m2`
- **Skill:** api
- **Inputs:** M1; SMTP from per-user runtime
- **Done when:** AC on #787
- **Verify with:** fixture Feature tests; `composer done-gate`
- **Parallel with:** apps `JmapMailClient` (#788 library portion)

## Test plan

- [ ] UIDVALIDITY `/changes` + stale-id `Email/get` `notFound`
- [ ] Mixed-domain and mixed-mailbox batch
- [ ] Write-then-sync incremental `/changes`
