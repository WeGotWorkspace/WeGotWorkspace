# Task issue draft — file manually, then renumber this folder

File via `.github/ISSUE_TEMPLATE/task.yml`, then:

1. `git mv .agents/specs/000-jmap-envelope-contacts .agents/specs/<N>-jmap-envelope-contacts`
2. Set `Source: #<N> (body-hash: <first 8 hex of: gh issue view <N> --json body --jq .body | shasum -a 256>)` in [spec.md](./spec.md)
3. Delete this file.

---

**Template:** `.github/ISSUE_TEMPLATE/task.yml` · **Label:** `type:task` · **Parent:** the multi-domain envelope Epic ([../000-jmap-envelope-multidomain/issue-drafts.md](../000-jmap-envelope-multidomain/issue-drafts.md)) · **Branch:** `feat/jmap-envelope-contacts`

## Title

```
feat(api): JMAP envelope methods for contacts (RFC 9610)
```

## Body

```markdown
Parent: #<epic>
Depends on: #<chore P>

Add `AddressBook/*` and `ContactCard/*` to the JMAP envelope behind
`urn:ietf:params:jmap:contacts`, wrapping the existing contacts services
(`AddressBookRepository`, `ContactCardRepository`, `ContactCardSetService`,
`JmapContactStateService`) — same additive-adapter pattern as calendars (#430).

Spec: `.agents/specs/<N>-jmap-envelope-contacts/`

### Acceptance criteria

- [ ] `addressbookSyncTokens()` primitive (analog of `CalendarEventRepository::calendarSyncTokens()`) feeding `JmapAccountStateCodec`
- [ ] `AddressBook/get|changes|set` and `ContactCard/get|changes|set|query` dispatched; `ContactCard/queryChanges` → `cannotCalculateChanges`
- [ ] Envelope adapters normalize the legacy REST shapes (string-valued `created`/`updated`, snake_case SetError types) to RFC 8620; REST endpoints untouched
- [ ] Top-level `ifInState` on `ContactCard/set` (account-wide codec states), mirroring `CalendarEventSetMethod`
- [ ] Contact photo `media` blobIds resolve against the existing `ContactBlobService` store; deviation documented until real envelope blobs land
- [ ] Lifecycle contract test mirroring `JmapClientContractTest` incl. incremental post-write sync; mixed-domain batch test (`Calendar/get` + `ContactCard/get`, states don't bleed)
- [ ] Session advertises `urn:ietf:params:jmap:contacts` (RFC 9610 capability object); OpenAPI + `jmap-envelope.md` updated; `composer done-gate`
```
