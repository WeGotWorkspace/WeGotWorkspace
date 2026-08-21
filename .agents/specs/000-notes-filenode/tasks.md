# Engineering tasks — Notes as FileNodes

**Not** a copy of a GitHub issue checklist. Chunk ids match [plan.md](./plan.md) and the `feat/` branch slugs.

Source spec: [spec.md](./spec.md)  
Source plan: [plan.md](./plan.md)

## Chunks

| id | owner / agent | skill | key paths | verify command | status |
|----|---------------|-------|-----------|----------------|--------|
| `notes-filenode-index` | builder | api | `packages/api/app/Services/Jmap/FileNodes/FileNodeIndexService.php`, `packages/api/docs/files/jmap-filenode-design.md` | PHPUnit FileNode + Drive hide-`.notes`; `pnpm test:api-done-gate` | done |
| `notes-filenode-api` | builder | api | `FileNodeMapper.php`, `NoteMarkdownCodec.php`, `NoteRepository.php`, Drive share listing, OpenAPI if path changed | FileNode feature tests + REST starred GET/PUT green (`NotesItemsTest`, `NotesMetadataMutationTest`) | done |
| `notes-filenode-app` | builder | workspace | `packages/apps/src/lib/api/wgw/notes.ts`, notes-core, notes hybrid/outbox, docs-stars-store | Vitest notes mapper + notes-core + notes offline | done |
| `notes-filenode-sunset` | builder | api | `packages/api/routes/api.php`, OpenAPI `/notes/*`, `NoteRepository` HTTP surface | `pnpm test:api-done-gate`; no apps `/notes/` imports | done |
| `notes-filenode-verify` | verifier | testing | Drive + Notes + Docs | verifier PASS / PASS_WITH_NITS | pending |

## Notes

- Source: ad-hoc — no GitHub Task yet. File Epic + Tasks under Goal #380 after the PRs; then re-point `Source:` and rename the folder to `<N>-notes-filenode`.
- Sequential only. New `feat/` from `main` per chunk after the previous PR merges.
- Codec YAML `starred` parse/emit was dropped in G.
- Breaking star drop is D (`feat(apps)!:`), not B.
