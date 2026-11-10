# Engineering tasks — One error shape from the server to the screen

**Not** a copy of the GitHub issue `- [ ]` acceptance checklist.

Source spec: [spec.md](./spec.md)  
Source plan: [plan.md](./plan.md)

Do not record chunk completion here. The GitHub issue and the test or file that proves the claim are the record.

## Chunks

| id | owner / agent | skill | key paths | verify command |
|----|---------------|-------|-----------|----------------|
| `chunk-a-api-error-shape` | builder | api | `packages/api/app/Exceptions/`, `packages/api/bootstrap/app.php`, `packages/api/app/Services/{Meet,Collab,Principal}/*ResponseException.php`, `.agents/skills/api/rest-design.md`, `packages/api/openapi/openapi.json` | `composer --working-dir packages/api done-gate` |
| `chunk-b-client-api-error` | builder | client-transport | `packages/apps/src/lib/api/`, `.agents/skills/client-transport/SKILL.md` | `pnpm test:apps-done-gate` |

## Notes

- Chunk A ships as its own PR; chunk B as a second PR.
