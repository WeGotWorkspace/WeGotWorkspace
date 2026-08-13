# Task issue draft — file manually, then renumber this folder

Issue creation is unavailable from the build environment (`gh` is read-only
there), so this Task must be filed by a maintainer. Afterwards:

1. `git mv .agents/specs/000-jmap-envelope-calendars .agents/specs/<N>-jmap-envelope-calendars`
2. Replace `Source: ad-hoc` in [spec.md](./spec.md) and [plan.md](./plan.md) with
   `Source: #<N> (body-hash: <first 8 hex of: gh issue view <N> --json body --jq .body | shasum -a 256>)`
3. Delete this file.

---

**Template:** `.github/ISSUE_TEMPLATE/task.yml` · **Label:** `type:task` · **Parent:** epic #137 · **Closed by:** PR #430

## Title

```
feat(api): JMAP transport envelope for calendars (RFC 8620)
```

## Body

```markdown
Parent: #137

Add a genuine RFC 8620 JMAP-over-HTTP transport in front of the existing
calendar services (additive third protocol adapter next to REST and CalDAV),
so the shipped `@lit-calendar/jmap-client` works against this backend with
zero client-side changes.

Spec: `.agents/specs/<N>-jmap-envelope-calendars/` · Docs: `packages/api/docs/calendars/jmap-envelope.md`

### Acceptance criteria

- [ ] `GET /api/v1/jmap/session` serves an RFC 8620 §2 Session resource: absolute URLs, accountId = raw username, calendars capability placed per draft-ietf-jmap-calendars-27 §1.5.1 (empty object at session level, six-property object in `accountCapabilities`)
- [ ] `POST /api/v1/jmap` dispatches batched method calls with ResultReference resolution (RFC 6901 + `*`), always HTTP 200 for structurally valid batches, RFC 7807 problem details for request-level errors, and advertised limits enforced (`maxCallsInRequest`, `maxObjectsInGet` incl. get-all, `maxObjectsInSet`, `maxSizeRequest`)
- [ ] Methods implemented over unmodified services: `Core/echo`, `Calendar/get|changes|set`, `CalendarEvent/get|changes|set|query|queryChanges` (queryChanges → `cannotCalculateChanges`)
- [ ] Account-wide state codec round-trips empty/single/multi-calendar maps; `CalendarEvent/changes` fan-out covers new/changed/unchanged/removed calendars; post-write sync takes the incremental path (mismatch-13 regression pinned)
- [ ] `CalendarEvent/set` implements genuine top-level `ifInState` (mismatch → nothing mutated); REST per-record `ifInState` untouched
- [ ] 8-property `myRights` mapping from Sabre's 3-level access
- [ ] Backend contract test replicates the shipped client's exact call sequences; live-client e2e path documented (`docs/calendars/jmap-client-e2e.md`)
- [ ] Existing REST endpoints unchanged; full `composer done-gate` green
```
