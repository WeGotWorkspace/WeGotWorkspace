# Mail app JMAP cutover — plan

Derived from [spec.md](./spec.md).

## Chunks

### Chunk D: JmapMailClient

- **id:** `chunk-d-client`
- **Skill:** workspace
- **Done when:** client + types + Vitest batches; app still on REST until E
- **Parallel with:** M2 after M1

### Chunk E: live source cutover

- **id:** `chunk-e-app`
- **Skill:** workspace
- **Done when:** AC on #788 except the library-only rows already in D
- **Verify with:** `pnpm test:apps-done-gate`
