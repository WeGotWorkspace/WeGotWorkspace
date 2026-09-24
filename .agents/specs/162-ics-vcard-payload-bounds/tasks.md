# Engineering tasks — ICS/vCard payload bounds

Source spec: [spec.md](./spec.md)  
Source plan: [plan.md](./plan.md)

## Chunks

| id | owner / agent | skill | key paths | verify command | status |
|----|---------------|-------|-----------|----------------|--------|
| `chunk-a-contract-tests` | builder | api | `.agents/specs/162-ics-vcard-payload-bounds/`, `packages/api/openapi/`, `packages/api/tests/Unit/VObject/`, `packages/api/tests/Feature/Jmap*PayloadBounds*`, `packages/openapi-types/generated/` | `php artisan test --filter='VObjectPayloadGuardTest\|JmapRestPayloadBoundsTest\|JmapCalendarPayloadBoundsTest\|JmapContactsPayloadBoundsTest'` | pending |
| `chunk-b-enforce` | builder | api | `VObjectPayloadGuard.php`, import repos/controllers, `JmapSetErrors.php`, get/list methods, `config/wgw.php` | same filter (green) | pending |
| `chunk-c-verify` | builder | testing | `jmap-rest-parity-gaps.md`, follow-up issue | `pnpm test:api-done-gate` | pending |

## Notes

- Two local commits (A then B); do not merge A alone.
- Do not invent the follow-up issue number in the spec before filing; link after it exists.
