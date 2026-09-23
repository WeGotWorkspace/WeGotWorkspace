# IMAP fixture — plan

Derived from [spec.md](./spec.md). Parallel with per-user servers (#784).

## Chunks

### Chunk A: IMAP fixture

- **id:** `chunk-a-fixture`
- **Skill:** api
- **Done when:** AC on #785
- **Verify with:** `composer done-gate` with and without `WGW_IMAP_FIXTURE_HOST`
- **Parallel with:** `chunk-s-per-user-servers`
