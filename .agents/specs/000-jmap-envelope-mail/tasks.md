# Tasks — JMAP envelope: mail (draft)

Engineering split per [plan.md](./plan.md). M1/M2 are filed only if #440 concludes "build" ([issue-draft.md](./issue-draft.md)). M0 delivers a document, not code.

| id | owner | skill | key paths | verify | status |
|----|-------|-------|-----------|--------|--------|
| chunk-m0-mail-design | planner | plan-feature, api | [`packages/api/docs/mail/jmap-mail-decision.md`](../../../packages/api/docs/mail/jmap-mail-decision.md) | maintainer review of build/defer/reject + phase-1 scope | done — #440, awaiting review (recommendation: **build M1**, gated on an IMAP CI fixture) |
| chunk-m1-mail-read | builder | api | `app/Services/Jmap/Methods/Mailbox*`, `Email*`, `Thread*`, `app/Services/Mail/*` (read adapters), `tests/Feature/Jmap/JmapMailMethodsTest.php` | lifecycle contract test vs IMAP fixture; done gate | pending — after #440 ("build") + #438 |
| chunk-m2-mail-write | builder | api | `app/Services/Jmap/Methods/EmailSet*`, `Identity*`, `EmailSubmission*`, `app/Services/Mail/*` | write-then-sync incremental path; submission test; done gate | pending — after chunk-m1 |
