# Engineering tasks — JMAP Mail envelope

Source spec: [spec.md](./spec.md)

## Chunks

| id | owner / agent | skill | key paths | verify command | status |
|----|---------------|-------|-----------|----------------|--------|
| `chunk-b-m1` | builder | api | `packages/api/app/Services/Jmap/Mail/`, mail methods, migrations, blob resolver | `composer done-gate` | pending |
| `chunk-c-m2` | builder | api | Email/set, Mailbox/set, Identity, EmailSubmission | `composer done-gate` | pending |
