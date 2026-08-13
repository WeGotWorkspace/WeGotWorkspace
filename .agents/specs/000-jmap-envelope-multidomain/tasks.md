# Tasks — JMAP envelope multi-domain expansion (draft)

Engineering split per [plan.md](./plan.md). **Draft** — rows become actionable when their Task issues are filed and PR #430 has merged.

| id | owner | skill | key paths | verify | status |
|----|-------|-------|-----------|--------|--------|
| chunk-p-envelope-decouple | builder | api | `routes/api.php`, `app/Services/Jmap/JmapCapabilities.php`, `app/Http/Controllers/Api/V1/Jmap/*`, `tests/Feature/Jmap/JmapDispatcherTest.php` | existing Jmap suites green unchanged; gated-capability test; `composer done-gate` | pending |
| chunk-c-contacts-envelope | builder | api | `app/Services/Jmap/Methods/ContactCard*`, `app/Services/Contacts/*`, `tests/Feature/Jmap/JmapContactsMethodsTest.php` | lifecycle contract test; done gate | pending — after chunk-p |
| chunk-t-rest-task-sync | builder | api | `app/Services/Tasks/*`, `routes/api.php`, `tests/Feature/Tasks/*` | parity with calendar event sync tests; done gate | pending |
| chunk-t-envelope-tasks | builder | api | `app/Services/Jmap/Methods/Task*`, `tests/Feature/Jmap/JmapTasksMethodsTest.php` | lifecycle contract test; done gate | pending — after chunk-p + chunk-t-rest |
| chunk-m-mail-assessment | planner | plan-feature | decision doc (`docs/product/` or epic body) | maintainer review of build/defer/reject recommendation | pending |
