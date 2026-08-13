# Tasks — JMAP envelope: contacts (draft)

Engineering split per [plan.md](./plan.md). Delivery issue: #437.

| id | owner | skill | key paths | verify | status |
|----|-------|-------|-----------|--------|--------|
| chunk-c-contacts-envelope | builder | api | `app/Services/Jmap/Methods/AddressBook*`, `app/Services/Jmap/Methods/ContactCard*`, `app/Services/Contacts/*`, `tests/Feature/Jmap/JmapContactsMethodsTest.php` | lifecycle contract test; mixed-domain batch test; done gate | pending — after umbrella chunk P |
