# Engineering tasks — Ownership access matrix (REST + JMAP)

**Not** a copy of an issue checklist. This file tracks **which agent/chunk implements which technical piece** for multitask and worktree handoffs.

Source spec: [spec.md](./spec.md)  
Source plan: [plan.md](./plan.md)

Do not record chunk completion here. The test or file that proves the claim is the record.

## Chunks

| id | owner / agent | skill | key paths | verify command |
|----|---------------|-------|-----------|----------------|
| `chunk-a-harness` | builder | testing | `packages/api/tests/Support/Ownership/`, `packages/api/tests/Architecture/OwnershipMatrixCoverageTest.php` | `vendor/bin/phpunit tests/Architecture/OwnershipMatrixCoverageTest.php` and `composer done-gate` |
| `chunk-b-calendars` | builder | testing | `packages/api/tests/Feature/Ownership/CalendarsOwnershipTest.php` | `vendor/bin/phpunit tests/Feature/Ownership/CalendarsOwnershipTest.php` |
| `chunk-c-tasks` | builder | testing | `packages/api/tests/Feature/Ownership/TasksOwnershipTest.php` | `vendor/bin/phpunit tests/Feature/Ownership/TasksOwnershipTest.php` |
| `chunk-d-notes` | builder | testing | `packages/api/tests/Feature/Ownership/NotesOwnershipTest.php` | `vendor/bin/phpunit tests/Feature/Ownership/NotesOwnershipTest.php` |
| `chunk-e-chat` | builder | testing | `packages/api/tests/Feature/Ownership/ChatOwnershipTest.php` | `vendor/bin/phpunit tests/Feature/Ownership/ChatOwnershipTest.php` |
| `chunk-f-contacts` | builder | testing | `packages/api/tests/Feature/Ownership/ContactsOwnershipTest.php` | `vendor/bin/phpunit tests/Feature/Ownership/ContactsOwnershipTest.php` |
| `chunk-g-drive` | builder | testing | `packages/api/tests/Feature/Ownership/DriveOwnershipTest.php` | `vendor/bin/phpunit tests/Feature/Ownership/DriveOwnershipTest.php` |
| `chunk-h-account` | builder | testing | `packages/api/tests/Feature/Ownership/AccountOwnershipTest.php` | `vendor/bin/phpunit tests/Feature/Ownership/AccountOwnershipTest.php` |
| `chunk-p-public` | builder | testing, security | `packages/api/tests/Feature/Ownership/PublicAccessOwnershipTest.php` | `vendor/bin/phpunit tests/Feature/Ownership/PublicAccessOwnershipTest.php` |
| `chunk-s-group-sharing` | builder | testing | `packages/api/tests/Feature/Ownership/GroupSharingOwnershipTest.php` | `vendor/bin/phpunit tests/Feature/Ownership/GroupSharingOwnershipTest.php` |
| `chunk-v-verify` | verifier | testing, code-review | all of the above | `composer done-gate`; `grep -rn -- '->pending(' packages/api/tests/Feature/Ownership` is empty |

## Notes

- Chunk `id` values match `plan.md` chunk ids.
- Each domain chunk writes only its own test file and its own entries in `OwnershipRegistry`. Registry entries are grouped per domain in separate methods, so parallel chunks do not edit the same lines.
- Commands run from `packages/api`.
