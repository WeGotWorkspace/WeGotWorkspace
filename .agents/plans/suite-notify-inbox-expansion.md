# Suite notify inbox expansion

Planning note for expanding the curated `NotifyListener` allow-list beyond Epic [#741](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/741) first producers. Architecture: [docs/architecture/suite-notify.md](../../docs/architecture/suite-notify.md). Spec baseline: [.agents/specs/741-suite-notify/](../specs/741-suite-notify/).

**Status:** product decisions resolved; delivery Epic/Tasks filed (see [Filed issues](#filed-issues)). **No production code in this pass.**

**Language:** English artifacts only.

---

## Goal

Grow the suite tray so the listed Domains produce inbox rows (format-at-edge facts → tray / VAPID copy) with correct recipients and navigate deep links, without turning `NotifyListener` into a firehose.

## Non-goals

- Notification preferences UI / storage / mute rules (beyond actor-never-notified) — **documented only**; see [Future: per-event delivery preferences](#future-per-event-delivery-preferences)
- Closing Goal [#493](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/493) (Calendar closed-tab push)
- Email fan-out ([#553](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/553))
- Guest / public-link sharees without an instance principal
- Migrating search onto `EventDispatch`
- Expanding #741’s platform slices (envelope/VAPID already on `feat/suite-notify`)

## Affected packages

- `packages/api` — producers, allow-list, `NotificationCopyFormatter` + per-action helpers, feature tests
- `packages/apps` — `format-notification-copy.ts` + Vitest; tray navigate already generic
- `docs/architecture/suite-notify.md` — allow-list + producer table

## Research summary (write paths)

| Requested outcome | Feasibility | Exists today? | Primary hook |
|-------------------|-------------|---------------|--------------|
| Docs: collaborator mention/reply in thread | **Partial** — reply/thread yes; **@mention greenfield** (#549) | Laravel `DocsThreadPosted` only (not tray) | `DocsThreadEventEmitter` ← `DocsThreadRepository::{create,reply}` |
| Docs: owner any new comment/suggestion | **Yes** | Same emitter; no tray | Same |
| Drive: shared with me | **Mostly done** | `docs.shared` on `createShare` only | `DriveShareService::notifySharees` |
| Calendar: RSVP update | **Yes** | iTIP REPLY lands; tray only on `REQUEST` | `deliverLocal` on `METHOD=REPLY` (covers REST/JMAP/CalDAV via `scheduleAfterWrite`; do **not** hook only `respond`) |
| Calendar: access granted | **Yes** | Share API; no notify | `CalendarShareInvites::apply` via `CalendarRepository::{create,update}` |
| Meet: meeting started | **Yes** | `markActivated` when first joinable peer | `MeetReservationService::markActivated` ← signaling join; channel rooms → `MeetChannelJoinPolicy` + roster |
| Meet: mentioned in chat | **Blocked** on server mention persistence | UI parses mentions; API returns `mentions: []` | Persistent `ChatMessageRepository::create` only — **not** in-call ephemeral `MeetSignalingService::chat` |
| Notes: notebook access granted | **Yes** | Share on **update** only (create has no `shareWith`); no notify | `NotebookRepository::update` → `CalendarShareInvites::apply` (#661/#665) |
| Tasks: list access granted | **Yes** | Share on **update** only; no notify | `TaskListRepository::update` → `CalendarShareInvites::apply` (#559/#650) |
| Tasks: status changed by someone else | **Yes** (CalDAV gap) | `TaskRepository::{update,patch}` only; no diff notify | After ICS write, compare STATUS; CalDAV PUT → coarse `calendar.written` (v1 = REST/MCP) |

---

## Resolved product decisions

### 1. Drive vs Docs share — single action `docs.shared`

**Decision:** Keep **one** share event. A Docs share **is** a Drive share. Do **not** dual-fire `docs.shared` + `drive.shared`. Do **not** introduce a second allow-list key.

**Chosen `domain.action`:** `docs.shared` (keep existing key from #747).

**Why not rename to `drive.shared`:** `#747` already allow-lists and tests `docs.shared`; rename would churn formatters, allow-list, and any inbox rows mid-pipeline for no recipient/navigate gain. Navigate already branches: collab `.md` → `/docs`, other paths → `/drive` (`DocsSharedNotify::eventData`). One producer (`DriveShareService::notifySharees`), one inbox row per grant.

**Still required:** `updateShare` must notify **delta** newly added member sharees (not revokes / unchanged grants). Guest / public-link sharees without a principal stay out of scope.

**Note-path `.md` caveat (deferred):** note-path shares that end in `.md` still navigate to `/docs` via the extension heuristic — revisit `/notes` only if product later splits surfaces; not part of this Epic’s AC.

### 2. Docs collaborator scope (comment / suggestion activity)

**Decision — apply both rules** for `docs.thread_activity`:

1. **ACL owners** of the path except the acting user.
2. **Thread participants** — anyone who is part of the thread. Being **@mentioned anywhere in the thread** auto-subscribes that principal to subsequent thread activity (same recipient set thereafter).

Union recipients; actor never notified. Group-owned docs (`/groups/{slug}/…`) still need an owner-resolution policy at implement time (managers vs all writers) — document in Task AC as “path ACL owners as resolved by existing Drive ACL helpers.”

**Mentions as notify action:** full `docs.mentioned` rows remain Goal [#549](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/549) (persistence). Until then, mention-in-thread only affects **subscription** for `docs.thread_activity` if mentions are already present in stored bodies; do not invent a second inbox row type before #549.

### 3. Meet started recipients

**Decision:** Notify **invitees** and **channel members** (roster), excluding the actor.

**Calendar attendees:** if the attendee is **external** (no WGW principal), **skip**; if **internal** (WGW principal), **include**.

Fire once on first `markActivated` (`activated_at` null→set). Guest first-peer fan-out without a principal stays out of scope unless they map to an invitee principal already in the set.

### 4. Task status changed recipients

**Decision:** Notify **ACL owners of the task list** except the acting user. Do **not** fan out to all read sharees by default. Assignees (#563) are **not** required for v1 unless already present as list owners.

Default transition surface: any STATUS change on REST/MCP `TaskRepository::{update,patch}` (formatters may emphasize complete); CalDAV PUT remains out of scope for v1.

### 5. Chat mention vs `message_posted` (no duplicate rows)

**Decision:** For a single message that both posts and mentions users, **do not** create both `chat.message_posted` and `chat.mentioned` for the **same recipient**.

| Recipient | Action | Copy |
|-----------|--------|------|
| Mentioned user (∩ roster, − author) | `chat.mentioned` only | Mention-shaped |
| Other channel participants (− author, − mentioned) | `chat.message_posted` only | Message-posted |

Author never notified. Unknown mention tokens ignored. In-call ephemeral mesh chat stays out of the tray.

---

### Drive share (implementation note)

Today **one** action: `docs.shared`.

- Fires for **all** file/dir member shares on `createShare` (not only `.md`).
- Navigate: `.md` → `/docs`, else → `/drive`.
- **`updateShare` does not notify** newly added sharees — gap for ACL churn (Chunk C / filed Task).

### Docs threads vs Goals

- Goal [#548](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/548): share **half landed** (#747); **comment half** is Chunk A / Docs thread Task.
- Goal [#549](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/549): mention **UI/storage** — separate; link from Docs mention Task; do not pretend mention notify without persisting mentions.
- Emitter fires only on **new** root/reply with non-empty body (empty suggestion root skips); **not** on reactions / resolve / archive.
- SPA today: `DocsRouteSearch` supports `file` only — prefer navigate `/docs?file={pathSansSlash}` first; `&thread=` as follow-up SPA work.

### Collection ACL pattern (Calendar / Notes / Tasks)

Shared: `CalendarShareInvites::apply` (Sabre `updateInvites`). Diff **added** sharees (not revokes / access-only bumps) and notify those usernames. Same helper can serve calendar / notes / tasks with different `domain`.

**Gaps:** CalDAV `DAV:share-resource` POST is **not** on `EventDispatchPlugin` method list — REST/MCP `shareWith` is the v1 notify surface. Notebook/task-list **create** does not accept `shareWith` (share is patch-only) unless create-with-shareWith already exists for calendars.

---

## Recommended `domain.action` catalog

| domain.action | Recipients (actor excluded) | navigate | Key facts | Producer |
|---------------|----------------------------|----------|-----------|----------|
| `docs.thread_activity` | **ACL owners** ∪ **thread participants** (authors + mention-auto-subscribed); see decision §2 | `/docs?file=…` (later `&thread=`) | `actor`, `path`, `fileName`, `threadId`, `messageId`, `kind`, `isReply`, optional `snippet` | Swap `DocsThreadEventEmitter` → `EventDispatch::fireMutation('docs','thread_activity',…)` |
| `docs.mentioned` | Parsed @principals | `/docs?file=…` | same + `mentions[]` | **After** #549 persistence |
| `docs.shared` | New member sharees (users + expanded groups; not email-pending) | `/docs` or `/drive` by path | existing | Keep single key; also **`updateShare` when grants added** |
| `calendar.rsvp` | Local **organizer** only | `/calendar` | `actor` (invitee), `summary`, `uid`, `participationStatus`, `when?` | `deliverLocal` when `METHOD=REPLY` |
| `calendar.shared` | Newly granted sharees | `/calendar` | `actor`, `calendarName`, `calendarId`, `access` | After `CalendarShareInvites::apply` |
| `meet.started` | Channel members + invitees; calendar attendees: internal principals only (skip external) | Same as chat navigate (`/meet/channels|meetings|dms/…`) | `actor`, `room`, `channelUri?`, `kind?` | First `markActivated` only |
| `chat.mentioned` | Mentions ∩ channel roster (− author); **suppress** `message_posted` for these recipients | Same as `chat.message_posted` | `actor`, `channelName`, `snippet`, `mentions[]`, `messageId` | `ChatMessageRepository::create` after persistence |
| `notes.shared` | Newly granted notebook sharees | `/notes` | `actor`, `notebookName`, `notebookId`, `access` | After `shareWith` on notebook **update** |
| `tasks.list_shared` | Newly granted list sharees | `/tasks` | `actor`, `listName`, `taskListId`, `access` | After `shareWith` on list **update** |
| `tasks.status_changed` | List **ACL owners** (− actor) | `/tasks` | `actor`, `summary`, `taskId`, `fromStatus`, `toStatus`, `taskListId` | `TaskRepository::{update,patch}`; REST/MCP v1 |

**Allow-list:** add each pair to `NotifyListener::ALLOW_LIST`. Keep curation strict — do not allow-list coarse DAV `written` / `created`. **Do not** add `drive.shared`.

**Dedupe suggestions:**

- `docs.thread_activity:{threadId}` + `supersede` for rapid replies (or per-message if product wants every reply)
- `calendar.rsvp:{uid}:{attendee}` + supersede on PARTSTAT change
- `docs.shared:{shareId|path}:{sharee}` once per grant add
- `meet.started:{room}` once
- `tasks.status_changed:{taskId}` + supersede
- `chat.mentioned:{messageId}:{principal}`

---

## Phased chunks

### Chunk A — Docs comment / suggestion notify (#548 remainder)

- **Skill:** api, apps-ui, testing
- **Inputs:** `DocsThreadRepository`, `DocsThreadEventEmitter`, Drive path ACL owners + thread participant resolution
- **Work:**
  1. Replace Laravel `DocsThreadPosted` with `EventDispatch::fireMutation` (keep test assertions on inbox / allow-list).
  2. Resolve recipients per decision §2 (ACL owners ∪ thread participants / mention-auto-subscribe; actor skipped).
  3. Allow-list `docs.thread_activity`; PHP + TS formatters; feature tests.
  4. Navigate at least `/docs?file=…`; document thread deep-link as follow-up if SPA lacks `thread` query.
- **Done when:** new comment/suggestion/reply produces inbox for ACL owners and thread participants; Goal #548 comment AC verifiable.
- **Verify with:** `composer done-gate` subset + DocsThreads feature tests + formatter unit tests.
- **Parallel with:** Chunk C after decisions (done); not with mention Chunk B.

### Chunk B — Docs @mention notify (depends on #549)

- **Skill:** api, apps-ui, workspace
- **Inputs:** mention persistence in thread VJOURNAL / API (greenfield vs #549 delivery)
- **Work:** persist mentions → `docs.mentioned` → allow-list + formatters; wire auto-subscribe into thread_activity recipient set once mentions persist.
- **Done when:** mentioning a user notifies them via `docs.mentioned`; #549 mention visible + ping.
- **Parallel with:** none until #549 storage lands (can stub parser tests).

### Chunk C — Drive `updateShare` delta notify (single `docs.shared`)

- **Skill:** api
- **Inputs:** `DriveShareService::{createShare,updateShare,notifySharees}`
- **Work:** notify **delta** sharees on update under existing `docs.shared`; avoid re-notifying unchanged grants; **no** `drive.shared` split.
- **Done when:** ACL add on update notifies once; navigate still `/docs` vs `/drive` by path.
- **Parallel with:** A.

### Chunk D — Calendar RSVP → organizer tray

- **Skill:** api
- **Inputs:** `CalendarSchedulingService::deliverLocal`, `CalendarInviteNotify` patterns
- **Work:** on `METHOD=REPLY` inside `deliverLocal`; supersede on PARTSTAT change; skip self; do **not** notify on guest iMIP token respond (organizer is the writer).
- **Done when:** local invitee accept/decline creates organizer inbox row; feature test mirrors invite tests.
- **Parallel with:** E, F (collection shares).

### Chunk E — Collection access granted (Calendar / Notes / Tasks)

- **Skill:** api
- **Inputs:** `CalendarShareInvites::apply` call sites in `CalendarRepository`, `NotebookRepository`, `TaskListRepository`
- **Work:** shared “diff added sharees → fireMutation” helper; actions `calendar.shared`, `notes.shared`, `tasks.list_shared`.
- **Done when:** create-with-shareWith (where supported) and patch shareWith notify new sharees only.
- **Parallel with:** D; internal sub-slices may parallel by domain if helper lands first (Chunk E0 helper sequential).

### Chunk F — Task status changed

- **Skill:** api
- **Inputs:** `TaskRepository::{update,patch}`, status mapping in `TaskConversionSupport`; owner resolution akin to `AlertDueScheduler::ownerUsernames`
- **Work:** detect STATUS transition; recipients = list ACL owners (− actor); allow-list + formatters; document CalDAV PUT as out of scope for v1.
- **Done when:** sharee changing STATUS via REST/MCP notifies list owners; owner self-change does not self-notify.
- **Parallel with:** E.

### Chunk G — Meet started

- **Skill:** api, meet
- **Inputs:** `MeetReservationService::markActivated`, `MeetChannelJoinPolicy`, channel roster, invitee / calendar attendee resolution
- **Work:** fire once when `activated_at` flips null→set; recipients per decision §3; navigate like chat channel URLs.
- **Done when:** first joinable peer activates room → inbox for invitees + channel members (+ internal calendar attendees); second join does not duplicate; external calendar attendees skipped.
- **Parallel with:** F.

### Chunk H — Chat / Meet @mention notify

- **Skill:** api, meet, apps-ui
- **Inputs:** OpenAPI `ChatMention`, composer already sends mentions client-side; repository currently drops them
- **Work:** persist mentions on create; fire `chat.mentioned` to mentioned users; suppress `chat.message_posted` for those same recipients (decision §5). Explicitly exclude in-call ephemeral mesh chat from the tray.
- **Done when:** `@user` produces mention inbox only (no dual row); other participants still get `message_posted`; author excluded; unknown tokens ignored.
- **Parallel with:** B (shared mention patterns) after persistence design.

### Chunk V — Docs + architecture sync

- **Skill:** document
- **Inputs:** this plan + landed chunks
- **Work:** update `docs/architecture/suite-notify.md` allow-list and producers table; fold plan into `.agents/specs/<task>-suite-notify-expansion/` after Epic/Task filing.
- **Done when:** architecture matches allow-list; `pnpm run check:agent-docs` green.
- **Parallel with:** none (after merges).

## Dependencies (order)

1. ~~Product clarifications~~ — **resolved** (see above).
2. File Epic + Tasks — **done** (see [Filed issues](#filed-issues)); then `spec.md` / `plan.md` under `.agents/specs/<N>-…/` with `Source: #<task>`.
3. Chunk A (Docs comments) first for #548.
4. Chunk E0 shared ACL-diff helper before E calendar/notes/tasks.
5. Chunk B / H after mention persistence.
6. Chunk G uses Meet recipient decision §3.

## Test plan

- [ ] API: OpenAPI unchanged unless mention persistence adds fields → failing feature test → implement → `composer done-gate` / MCP `run_api_done_gate`
- [ ] Unit: formatter helpers per new `domain.action` (PHP + TS), mirror existing `*NotifyTest`
- [ ] Feature: one producer test per action (recipients, actor skip, dedupe/supersede, navigate)
- [ ] Feature: chat mention recipient gets only `chat.mentioned` (not also `message_posted`)
- [ ] UI: extend `format-notification-copy.test.ts`; Storybook fixtures if tray stories list domains
- [ ] Architecture doc allow-list parity

## Clarifications status

| # | Topic | Status |
|---|--------|--------|
| 1 | Drive vs Docs share | **Resolved** — keep single `docs.shared`; no dual-fire; navigate branches |
| 2 | Docs collaborator scope | **Resolved** — ACL owners ∪ thread participants (mention → auto-subscribe) |
| 3 | Group-owned docs owners | **Open at implement** — use existing ACL owner helpers; document in Chunk A |
| 4 | `meet.started` recipients | **Resolved** — invitees + channel members; internal calendar attendees only |
| 5 | `tasks.status_changed` | **Resolved** — list ACL owners (− actor); any STATUS on REST/MCP |
| 6 | Chat mentions vs `message_posted` | **Resolved** — no dual row; mention-shaped for mentioned users |
| 7 | Collection share revoke / downgrade | **Assumed add-only** (unchanged) |
| 8 | Note-path `.md` → `/notes` | **Deferred** |
| 9 | Goal parenting | **Resolved** — new Epic under #390; Docs comment also #548; mentions #549 |

## Research sources

Explorer passes (write-path deep dives; agent transcript ids): `86b20aa9-3aed-43e6-a42e-dc5c706154ce` (docs/drive), `bb42487e-4658-4cc4-b33e-4ac4ef91bb03` (calendar/meet), `21ebc738-1187-4cd8-81e2-92c11bbddbea` (notes/tasks).

---

## Future: per-event delivery preferences

**Document only — no implementation in expansion chunks.** Canonical detail: [docs/architecture/suite-notify.md](../../docs/architecture/suite-notify.md) → *Future: per-event delivery preferences*.

Product intent (independent toggles per app × event):

| Example | Likely `domain.action` | inbox | push |
|---------|------------------------|-------|------|
| Someone grants me calendar access | `calendar.shared` (expansion) | on | off |
| Someone invites me to an event | `calendar.invite` (exists) | on | on |
| Meeting alarm fires | `calendar.alert_due` (exists) | off | on |

**Model (summary):** `(principal, domain.action, channel)` where `channel` ∈ `{inbox, push}`. Defaults today = both **on** for every allow-listed action (matches current create→local→VAPID coupling).

**Evaluate later at two gates:**

1. `NotifyListener` — gate tray row create/clear (`inbox`).
2. `VapidPushService` (and delivery scheduling) — gate Web Push (`push`).

**Seam to loosen when prefs land:** push-only (`inbox` off / `push` on) cannot assume every VAPID send has a tray-visible `notifications` row. Do **not** add prefs schema, OpenAPI, or UI in Chunks A–H / V.

**Tracking:** Chore [#802](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/802) under Epic #793 — not a producer delivery slice.

---

## Filed issues

Prefer **not** expanding Epic #741 (first producers only). Delivery Epic under Goal #390:

| Draft | Chunk | Issue | Notes |
|-------|-------|-------|-------|
| Epic | — | [#793](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/793) | Parent Goal #390 |
| T1 | A | [#794](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/794) | Also Goal #548 comment half |
| T2 | C | [#795](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/795) | `docs.shared` delta only |
| T3 | D | [#796](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/796) | |
| T4 | E | [#797](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/797) | Related #559 / #661 |
| T5 | F | [#798](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/798) | |
| T6 | G | [#799](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/799) | Related #686 |
| T7 | H | [#800](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/800) | Related #686; dedupe vs `message_posted` |
| T-mention | B | [#801](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/801) | Links Goal #549 |
| C-prefs | — | [#802](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/802) | Tracking only; no prefs impl in producer chunks |

**Source:** Epic #793 (plan + ad-hoc spec). Spec folder remains `000-ad-hoc-suite-notify-expansion` until re-homed to `.agents/specs/793-suite-notify-expansion/` with body-hash.

### Mapping: request → chunk → Task

| User request | Chunk | Issue |
|--------------|-------|-------|
| Collaborator mention/reply | A (+ B for mention) | #794 + #801 |
| Doc owner / ACL owners new thread | A | #794 |
| Drive shared with me | C (exists; refine) | #795 |
| RSVP update | D | #796 |
| Calendar access granted | E | #797 |
| Meeting started | G | #799 |
| Mentioned in chat | H | #800 |
| Notebook access granted | E | #797 |
| List access granted | E | #797 |
| Task status changed | F | #798 |

---

## Next steps for maintainers

1. ~~Answer clarifications~~ — done.
2. ~~`gh issue create` Epic + Tasks~~ — done (#793–#801).
3. Re-home ad-hoc spec to `.agents/specs/793-suite-notify-expansion/` with `Source: #793` + body-hash.
4. Implement Chunk A (#794) first on `feat/suite-notify` or a follow-up `feat/` branch.
