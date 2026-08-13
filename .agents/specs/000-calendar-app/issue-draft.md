# Issue drafts — file manually, then renumber this folder

GitHub issue creation is unavailable from the build environment. File these three levels, then: `git mv .agents/specs/000-calendar-app .agents/specs/<EPIC-N>-calendar-app`, set `Source: #<EPIC-N> (body-hash: …)` in [spec.md](./spec.md), delete this file. Also still outstanding: the envelope Task from `.agents/specs/000-jmap-envelope-calendars/issue-draft.md`.

## 1. Goal (`goal.yml`, label `type:goal` + `area:calendar`, Product Project: Adopted)

**Title:** `Calendar in the workspace suite`

```markdown
**Outcome:** Workspace users manage their schedule in a first-class calendar app — month/week/day views, event editing, multiple calendars — that works offline and syncs like the other apps.

**Who:** every workspace user.

**Success looks like:** the calendar tile is live on the home screen; events created on one device appear on others; edits made offline sync when back online; CalDAV clients see the same data.

**Non-goals:** shared-calendar invitations/scheduling (iTIP), push/real-time updates (polling suffices), year view in v1.
```

## 2. Epic (`epic.yml`, label `type:epic`, parent: the Goal above)

**Title:** `feat(apps): calendar app — vendor lit-calendar and port to apps architecture`

```markdown
Parent: #<GOAL-N>

Vendor the framework-agnostic lit-calendar packages (events-api engine, jmap-client) into packages/apps and port the Lit UI to a React calendar-core on the workspace split shell, with offline support as the fifth Dexie offline-domain instance. Backend: the JMAP envelope on main (#430/#432).

Spec: `.agents/specs/<EPIC-N>-calendar-app/`

### Acceptance criteria

- [ ] `lib/calendar-engine` + `lib/jmap-client` vendored with green test suites; live e2e uses the in-repo client
- [ ] `calendar-core` registered end to end (app id, icons, routes, home tiles gated on `apps.calendars`, PWA manifest, SPA allowlist, runtime sync module)
- [ ] `lib/offline/calendars/` mirrors the contacts/tasks offline idiom over jmap transport; conflict queue + reconnect flush wired
- [ ] Month/week/day + agenda views; event editor with create/edit/delete incl. recurrence basics
- [ ] Storybook mock-tier coverage; `pnpm test:apps-done-gate` green; api done-gate green (allowlist change)
- [ ] lit-calendar repo archived with pointer README once parity confirmed
```

## 3. Tasks (`task.yml`, label `type:task`, parent: the Epic) — one per chunk

| Title | Body summary |
|-------|--------------|
| `feat(apps): vendor calendar engine and jmap client` | Chunk A per spec; AC: suites green, e2e rewired |
| `feat(apps): calendar-core skeleton and app registration` | Chunk B; AC: registration touchpoint list |
| `feat(apps): calendars offline domain over jmap transport` | Chunk C; AC: contract/flush/merge tests |
| `feat(apps): calendar views (month/week/day/agenda)` | Chunk D1 |
| `feat(apps): event editor and create flow` | Chunk D2 (drag interactions may split out) |
| `chore(apps): calendar ship gate + lit-calendar archival` | Chunk E |
