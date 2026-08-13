# Issue drafts (umbrella) — file manually

Issue creation is unavailable from the build environment (`gh` is read-only
there), so these must be filed by a maintainer. This file holds the **Epic**
and **chore P** only; per-domain Task bodies live in each domain folder's
`issue-draft.md`:

- [../000-jmap-envelope-contacts/issue-draft.md](../000-jmap-envelope-contacts/issue-draft.md)
- [../000-jmap-blobs/issue-draft.md](../000-jmap-blobs/issue-draft.md)
- [../000-jmap-envelope-filenode/issue-draft.md](../000-jmap-envelope-filenode/issue-draft.md) (design F0 + build F)
- [../000-jmap-envelope-mail/issue-draft.md](../000-jmap-envelope-mail/issue-draft.md) (design M0; M1/M2 only if M0 = build)

Filing order matters only for parenting: file the Epic first, then reference
it as `Parent:` in each Task/Chore. Per [issue-filing.md](../../skills/developer/issue-filing.md),
the Epic requires a parent **Goal** — pick the appropriate existing Goal
(offline/suite goals such as #385/#400/#402/#403 cover parts of this; mail
chunks fit #400) or file a new one; Epics/Tasks never go on the Product Project.

This umbrella folder keeps `Source: ad-hoc` (chore P needs no spec folder);
the domain folders get renumbered to their own `<N>-<slug>` when their Tasks
are filed — procedure at the top of each domain `issue-draft.md`.

---

## 1. Epic — JMAP multi-domain transport envelope

**Template:** `.github/ISSUE_TEMPLATE/epic.yml` · **Label:** `type:epic` · **Parent:** Goal (maintainer picks, see above)

### Title

```
feat(api): JMAP transport envelope for contacts, blobs, files, and mail
```

### Body

```markdown
Parent: #<goal>

Extend the RFC 8620 JMAP envelope shipped for calendars (#430) to the other
JMAP-shaped domains, so `/api/v1/jmap` becomes the single protocol front:
contacts (RFC 9610), real blob upload/download (RFC 8620 §6), files
(draft-ietf-jmap-filenode-14, pinned), and mail (RFC 8621, phased behind a
design gate).

Umbrella roadmap: `.agents/specs/000-jmap-envelope-multidomain/`; per-domain
specs in sibling folders. Non-goals across all children: JMAP Push, RFC 9670
sharing writes, changing REST endpoints or their legacy shapes, frontend work.

### Children (sequenced)

- [ ] Chore: envelope decoupling (routes + capability derivation)
- [ ] Task: contacts envelope (RFC 9610)
- [ ] Task: real blob infrastructure (RFC 8620 §6)
- [ ] Task: filenode node-identity design doc
- [ ] Task: files envelope (draft-filenode-14 pinned)
- [ ] Task: mail state-model design doc (build/defer/reject gate)
- [ ] Task: mail envelope read-only (if M0 = build)
- [ ] Task: mail writes + submission (if M0 = build)

Tasks (VTODO) is deliberately absent: `draft-ietf-jmap-tasks-06` is an expired,
immature draft — see the umbrella spec's Non-goals. The task item `/changes` +
`/set` REST gap stays tracked in parity-gaps (#158), outside this epic.
```

---

## 2. Chore — envelope decoupling (chunk P)

**Template:** `.github/ISSUE_TEMPLATE/chore.yml` · **Label:** `type:chore` · **Parent:** the Epic above · **Branch:** `refactor/jmap-envelope-decouple`

### Title

```
refactor(api): decouple JMAP envelope routes and capabilities from calendars
```

### Body

```markdown
Parent: #<epic>

The `/jmap*` routes live inside the `wgw.calendars` middleware group (a real
feature toggle — disabling calendars today takes the whole envelope down) and
the supported-capability set is hardcoded in three places
(`JmapApiController::handle()`, `JmapSessionController`, `JmapCapabilities`).
Every new envelope domain would re-hardcode these — remove the coupling first.

### Acceptance criteria

- [ ] `/jmap*` routes moved to a domain-neutral group (`wgw.auth` + `wgw.role:user`)
- [ ] Supported `using` set derived from registered methods' `capability()`
- [ ] Session `capabilities` / `accountCapabilities` / `primaryAccounts` pluggable per domain; feature-gated-off domains omitted from the session and rejected in `using` with `unknownCapability` (test pinned)
- [ ] Session `state` derived from the enabled capability set (no longer a global constant once capabilities can differ per account)
- [ ] All existing `tests/Feature/Jmap/*` green unchanged; `composer done-gate`
```
