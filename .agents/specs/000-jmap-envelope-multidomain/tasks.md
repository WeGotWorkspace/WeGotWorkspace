# Tasks — JMAP envelope multi-domain umbrella (draft)

Engineering split per [plan.md](./plan.md). This umbrella owns only chunk P; domain rows live in the domain folders. Tasks-domain rows removed 2026-08-13 (spec too immature — see [spec.md Non-goals](./spec.md#non-goals-apply-to-every-domain-folder)).

| id | owner | skill | key paths | verify | status |
|----|-------|-------|-----------|--------|--------|
| chunk-p-envelope-decouple | builder | api | `routes/api.php`, `app/Services/Jmap/JmapCapabilities.php`, `app/Http/Controllers/Api/V1/Jmap/*`, `tests/Feature/Jmap/JmapDispatcherTest.php` | existing Jmap suites green unchanged; gated-capability test; `composer done-gate` | issue filed — #436 |

Domain rows: [contacts](../437-jmap-envelope-contacts/tasks.md) · [blobs](../438-jmap-blobs/tasks.md) · [files](../000-jmap-envelope-filenode/tasks.md) · [mail](../000-jmap-envelope-mail/tasks.md)
