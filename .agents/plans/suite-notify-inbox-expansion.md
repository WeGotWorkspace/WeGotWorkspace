# Suite notify inbox expansion

Planning note for expanding the curated `NotifyListener` allow-list beyond Epic [#741](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/741) first producers. Architecture: [docs/architecture/suite-notify.md](../../docs/architecture/suite-notify.md). Spec baseline: [.agents/specs/741-suite-notify/](../specs/741-suite-notify/).

**Status:** research + phased plan. **No production code in this pass.** GitHub Epic/Tasks are drafted below — file only after product clarifications are confirmed (multi-Goal span).

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
| Meet: meeting started | **Yes** (product: who?) | `markActivated` when first joinable peer | `MeetReservationService::markActivated` ← signaling join; channel rooms → `MeetChannelJoinPolicy` + roster |
| Meet: mentioned in chat | **Blocked** on server mention persistence | UI parses mentions; API returns `mentions: []` | Persistent `ChatMessageRepository::create` only — **not** in-call ephemeral `MeetSignalingService::chat` |
| Notes: notebook access granted | **Yes** | Share on **update** only (create has no `shareWith`); no notify | `NotebookRepository::update` → `CalendarShareInvites::apply` (#661/#665) |
| Tasks: list access granted | **Yes** | Share on **update** only; no notify | `TaskListRepository::update` → `CalendarShareInvites::apply` (#559/#650) |
| Tasks: status changed by someone else | **Yes** (product: who?; CalDAV gap) | `TaskRepository::{update,patch}` only; no diff notify | After ICS write, compare STATUS; CalDAV PUT → coarse `calendar.written` (v1 = REST/MCP) |

### Drive vs Docs share (product clarification)

Today **one** action: `docs.shared`.

- Fires for **all** file/dir member shares on `createShare` (not only `.md`).
- Navigate: `.md` → `/docs`, else → `/drive` (`DocsSharedNotify::eventData`).
- **`updateShare` does not notify** newly added sharees — gap for ACL churn.

**Recommendation:** keep `docs.shared` for collab docs (`.md`); add `drive.shared` for non-doc paths (same producer, branch on path). Alternatively keep one action and let copy/navigate branch on `fileName`/`path` (current behavior) — cheaper, slightly fuzzy domain label. Prefer **`drive.shared` + `docs.shared`** so tray icons/filters stay honest.

**Notes path caveat:** note-path shares that end in `.md` currently navigate to `/docs` via the extension heuristic — product may want `/notes` instead when splitting domains.

### Docs threads vs Goals

- Goal [#548](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/548): share **half landed**; **comment half** is this expansion’s highest-value Docs slice.
- Goal [#549](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/549): mention **UI/storage** — separate from notify; do not pretend mention notify without persisting mentions.
- Emitter comment still says “swap onto EventDispatch when #741 lands” — #741 is on this branch; swap is leftover.
- Emitter fires only on **new** root/reply with non-empty body (empty suggestion root skips); **not** on reactions / resolve / archive.
- SPA today: `DocsRouteSearch` supports `file` only — no `thread` query; `activeThreadId` is in-memory. Prefer navigate `/docs?file={pathSansSlash}` first; `&thread=` as follow-up SPA work. Tray consume-match can use `data.path` (same pattern as share).

### Collection ACL pattern (Calendar / Notes / Tasks)

Shared: `CalendarShareInvites::apply` (Sabre `updateInvites`). No `EventDispatch` today. Diff **added** sharees (not revokes / access-only bumps unless product wants “access changed”) and notify those usernames. Same helper can serve calendar / notes / tasks with different `domain` (branch on component set: VEVENT / VJOURNAL / VTODO).

**Gaps:** CalDAV `DAV:share-resource` POST is **not** on `EventDispatchPlugin` method list — native CalDAV ACL grants emit nothing; REST/MCP `shareWith` is the v1 notify surface. Notebook/task-list **create** does not accept `shareWith` (share is patch-only).

---

## Recommended `domain.action` catalog

| domain.action | Recipients (actor excluded) | navigate | Key facts | Producer |
|---------------|----------------------------|----------|-----------|----------|
| `docs.thread_activity` | **Owner** always on new root; **thread participants** (root author + prior reply authors) on reply; optional later: path sharees with `mayComment`/`mayView` (expand groups like `shareeUsernames`) | `/docs?file=…` (later `&thread=`) | `actor`, `path`, `fileName`, `threadId`, `messageId`, `kind`, `isReply`, optional `snippet` | Swap `DocsThreadEventEmitter` → `EventDispatch::fireMutation('docs','thread_activity',…)` (alt: split `comment_posted` / `suggestion_posted` to match emitter names) |
| `docs.mentioned` | Parsed @principals | `/docs?file=…` | same + `mentions[]` | **After** #549 persistence; same write path |
| `docs.shared` | New member sharees (users + expanded groups; not email-pending) | `/docs` | existing | Keep; restrict to collab-doc paths if `drive.shared` splits |
| `drive.shared` | New member sharees | `/drive` | `actor`, `path`, `fileName`, `shareId` | Same `notifySharees`; also **`updateShare` when grants added** |
| `calendar.rsvp` | Local **organizer** only | `/calendar` | `actor` (invitee), `summary`, `uid`, `participationStatus`, `when?` | `deliverLocal` when `METHOD=REPLY`; skip guest iMIP token path (organizer already wrote); iMIP-external mail stays out of tray |
| `calendar.shared` | Newly granted sharees | `/calendar` | `actor`, `calendarName`, `calendarId`, `access` | After `CalendarShareInvites::apply` (create + update) |
| `meet.started` | Channel rooms: `ChatChannelRepository::rosterUsernames` (− actor, − peers already in room); ad-hoc: `owner_principal` / `created_by` (product) | Same as chat navigate (`/meet/channels|meetings|dms/…`) | `actor`, `room`, `channelUri?`, `kind?` | First `markActivated` only; confirm whether guest first-peer should fan out |
| `chat.mentioned` | Mentions ∩ channel roster (− author) | Same as `chat.message_posted` | `actor`, `channelName`, `snippet`, `mentions[]`, `messageId` | `ChatMessageRepository::create` after persistence; dual with roster `message_posted` unless product suppresses |
| `notes.shared` | Newly granted notebook sharees | `/notes` | `actor`, `notebookName`, `notebookId`, `access` | After `shareWith` on notebook **update** |
| `tasks.list_shared` | Newly granted list sharees | `/tasks` | `actor`, `listName`, `taskListId`, `access` | After `shareWith` on list **update** |
| `tasks.status_changed` | List **owner(s)** (+ assignees when #563 lands); **not** all read sharees by default | `/tasks` | `actor`, `summary`, `taskId`, `fromStatus`, `toStatus`, `taskListId` | `TaskRepository::{update,patch}`; prefer fire on transition **to** `completed` (or any STATUS — product); REST/MCP v1 |

**Allow-list:** add each pair to `NotifyListener::ALLOW_LIST`. Keep curation strict — do not allow-list coarse DAV `written` / `created`.

**Dedupe suggestions:**

- `docs.thread_activity:{threadId}` + `supersede` for rapid replies (or per-message if product wants every reply)
- `calendar.rsvp:{uid}:{attendee}` + supersede on PARTSTAT change
- `*.shared:{collectionId}:{sharee}` once per grant add
- `meet.started:{room}` once
- `tasks.status_changed:{taskId}` + supersede
- `chat.mentioned:{messageId}:{principal}`

---

## Phased chunks

### Chunk A — Docs comment / suggestion notify (#548 remainder)

- **Skill:** api, apps-ui, testing
- **Inputs:** `DocsThreadRepository`, `DocsThreadEventEmitter`, Drive path owner + optional grant listing
- **Work:**
  1. Replace Laravel `DocsThreadPosted` with `EventDispatch::fireMutation` (keep test assertions on inbox / allow-list).
  2. Resolve recipients: path owner from `/users/{u}/…` or group managers policy (clarify group docs); on reply also prior thread authors.
  3. Allow-list `docs.thread_activity`; PHP + TS formatters; feature tests (owner notified, actor skipped, reply fans thread participants).
  4. Navigate at least `/docs?file=…`; document thread deep-link as follow-up if SPA lacks `thread` query.
- **Done when:** new comment/suggestion/reply produces inbox for owner (and reply participants); Goal #548 comment AC verifiable.
- **Verify with:** `composer done-gate` subset + DocsThreads feature tests + formatter unit tests.
- **Parallel with:** Chunk C (Drive ACL gap) after clarifications; not with mention Chunk B.

### Chunk B — Docs @mention notify (depends on #549)

- **Skill:** api, apps-ui, workspace
- **Inputs:** mention persistence in thread VJOURNAL / API (greenfield vs #549 delivery)
- **Work:** persist mentions → `docs.mentioned` → allow-list + formatters.
- **Done when:** mentioning a user notifies them; #549 mention visible + ping.
- **Parallel with:** none until #549 storage lands (can stub parser tests).

### Chunk C — Drive share domain split + `updateShare` notify

- **Skill:** api
- **Inputs:** `DriveShareService::{createShare,updateShare,notifySharees}`
- **Work:** optional `drive.shared`; notify **delta** sharees on update; avoid re-notifying unchanged grants.
- **Done when:** non-`.md` share uses `/drive` domain.action; ACL add notifies once.
- **Parallel with:** A after product decision on split.

### Chunk D — Calendar RSVP → organizer tray

- **Skill:** api
- **Inputs:** `CalendarSchedulingService::deliverLocal`, `CalendarInviteNotify` patterns
- **Work:** on `METHOD=REPLY` inside `deliverLocal` (so CalDAV/JMAP PARTSTAT that hit `scheduleAfterWrite` are covered); supersede on PARTSTAT change; skip self; do **not** notify on guest iMIP token respond (organizer is the writer).
- **Done when:** local invitee accept/decline creates organizer inbox row; feature test mirrors invite tests.
- **Parallel with:** E, F (collection shares).

### Chunk E — Collection access granted (Calendar / Notes / Tasks)

- **Skill:** api
- **Inputs:** `CalendarShareInvites::apply` call sites in `CalendarRepository`, `NotebookRepository`, `TaskListRepository`
- **Work:** shared “diff added sharees → fireMutation” helper; actions `calendar.shared`, `notes.shared`, `tasks.list_shared`.
- **Done when:** create-with-shareWith and patch shareWith notify new sharees only.
- **Parallel with:** D; internal sub-slices may parallel by domain if helper lands first (Chunk E0 helper sequential).

### Chunk F — Task status changed

- **Skill:** api
- **Inputs:** `TaskRepository::{update,patch}`, status mapping in `TaskConversionSupport`; owner resolution akin to `AlertDueScheduler::ownerUsernames`
- **Work:** detect STATUS transition (default: to `completed`); recipients = list owners (+ assignees when present); allow-list + formatters; document CalDAV PUT as out of scope for v1.
- **Done when:** sharee completing a task via REST/MCP notifies chosen principals; owner self-complete does not self-notify.
- **Parallel with:** E after recipient clarification.

### Chunk G — Meet started

- **Skill:** api, meet
- **Inputs:** `MeetReservationService::markActivated`, `MeetChannelJoinPolicy`, channel roster
- **Work:** fire once when `activated_at` flips null→set; channel rooms → roster; ad-hoc rooms → product rule; navigate like chat channel URLs.
- **Done when:** first joinable peer activates room → inbox for chosen principals; second join does not duplicate.
- **Parallel with:** F; after recipient clarification.

### Chunk H — Chat / Meet @mention notify

- **Skill:** api, meet, apps-ui
- **Inputs:** OpenAPI `ChatMention`, composer already sends mentions client-side; repository currently drops them
- **Work:** persist mentions on create; fire `chat.mentioned` to mentioned users (may still also fire `message_posted` — product: keep both or suppress roster for mention-only preference later). Explicitly exclude in-call ephemeral mesh chat from the tray.
- **Done when:** `@user` produces mention inbox; author excluded; unknown tokens ignored.
- **Parallel with:** B (shared mention patterns) after persistence design.

### Chunk V — Docs + architecture sync

- **Skill:** document
- **Inputs:** this plan + landed chunks
- **Work:** update `docs/architecture/suite-notify.md` allow-list and producers table; optionally fold plan into `.agents/specs/<task>-suite-notify-expansion/` after Epic/Task filing.
- **Done when:** architecture matches allow-list; `pnpm run check:agent-docs` green.
- **Parallel with:** none (after merges).

## Dependencies (order)

1. Product clarifications (below).
2. File Epic + Tasks (drafts in this doc) — then `spec.md` / `plan.md` under `.agents/specs/<N>-…/` with `Source: #<task>`.
3. Chunk A (Docs comments) first for #548.
4. Chunk E0 shared ACL-diff helper before E calendar/notes/tasks.
5. Chunk B / H after mention persistence.
6. Chunk G after Meet recipient decision.

## Test plan

- [ ] API: OpenAPI unchanged unless mention persistence adds fields → failing feature test → implement → `composer done-gate` / MCP `run_api_done_gate`
- [ ] Unit: formatter helpers per new `domain.action` (PHP + TS), mirror existing `*NotifyTest`
- [ ] Feature: one producer test per action (recipients, actor skip, dedupe/supersede, navigate)
- [ ] UI: extend `format-notification-copy.test.ts`; Storybook fixtures if tray stories list domains
- [ ] Architecture doc allow-list parity

## Product clarifications needed

1. **Drive vs Docs share:** split `drive.shared` / `docs.shared`, or keep single action with navigate branch?
2. **Docs collaborator scope:** owner-only vs owner + all comment-capable sharees vs thread participants only for replies?
3. **Group-owned docs** (`/groups/{slug}/…`): who is “owner” for notify (all group members with write? managers only?)?
4. **`meet.started` recipients:** channel roster (recommended), calendar invitees, reservation owner only, or combination? Should a **guest** first peer activate + fan out?
5. **`tasks.status_changed`:** complete-only vs any STATUS; recipients = list owner only vs owners + assignees (#563) vs write sharees?
6. **Chat mentions vs `message_posted`:** dual notify (roster + mention) OK for beta, or mention-only for DMs later?
7. **Collection share on revoke / access downgrade:** notify? (plan assumes **add-only**).
8. **Note-path `.md` shares:** navigate `/docs` vs `/notes`?
9. **New Goals:** Meet started / calendar shared / notes shared / task status may need Goals if not folded under [#390](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/390) “events and tasks while using the app”.

## Research sources

Explorer passes (write-path deep dives): [Explore docs/drive notify](86b20aa9-3aed-43e6-a42e-dc5c706154ce), [Explore calendar/meet notify](bb42487e-4658-4cc4-b33e-4ac4ef91bb03), [Explore notes/tasks notify](21ebc738-1187-4cd8-81e2-92c11bbddbea).

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

**Optional tracking:** after the expansion Epic is filed, add a single small Chore under that Epic (draft below) — do **not** file a prefs Epic now.

---

## Issue filing recommendation (draft — do not file until confirmed)

Per [issue-filing.md](../skills/developer/issue-filing.md) + [plan-feature](../skills/plan-feature/SKILL.md): file delivery **Epic/Tasks** before numbered `spec.md`. Prefer **not** expanding Epic #741 body further (it scoped first producers). File a **new Epic** under Goal **#390**, with Docs comment Task also linking Goal **#548**.

### Epic (draft)

**Title:** `[Epic] Suite notify producer expansion`

**Parent goal:** #390 — Get notified about events and tasks while using the app

**Related goals:** #548 (Docs comment half), #549 (Docs mention), #559 (task list share context), #661 (notebook share context), #686 (Meet chat)

**Scope:** Extend curated notify allow-list and producers for Docs threads, Drive ACL delta, Calendar RSVP + calendar share, Notes/Tasks collection share, task status changes, Meet started, and chat mentions (after persistence). Reuse envelope + format-at-edge; no preferences UI.

**Slices:**

- [ ] Docs thread activity notify (comment/suggestion/reply) — closes #548 comment gap
- [ ] Drive share domain split + updateShare delta notify
- [ ] Calendar RSVP → organizer tray
- [ ] Collection access granted (calendar / notes / tasks) shared helper
- [ ] Task status changed by someone else
- [ ] Meet meeting started
- [ ] Chat mention persistence + `chat.mentioned` (coord with #549 for Docs)

**Out of scope:** #493 closed-tab Calendar; email #553; preferences UI/storage (see C-prefs draft only); AuditListener; guest sharees

**Done when:** each slice has feature tests; architecture allow-list updated; actors never self-notified; formatters cover new actions in PHP + TS.

### Task drafts (under Epic)

#### T1 — Docs thread activity notify

**Title:** `[Task] Docs comment/suggestion thread activity → suite inbox`

**Parent:** new Epic (above); Goal context #548

**Acceptance criteria:**

- [ ] `DocsThreadRepository` create/reply fires `EventDispatch` `docs.thread_activity` (Laravel-only `DocsThreadPosted` removed or bridged)
- [ ] Allow-list includes `docs.thread_activity`; actor never notified
- [ ] Doc owner receives inbox on new root comment/suggestion
- [ ] Reply notifies prior thread participants (and owner if not already)
- [ ] Facts include path, threadId, kind, isReply; navigate `/docs`
- [ ] PHP + TS formatters + feature tests

**Non-goals:** @mention parsing (#549); email; guest commenters

#### T2 — Drive share delta + optional `drive.shared`

**Title:** `[Task] Drive/Docs share notify on ACL add and domain split`

**Parent:** new Epic; related #548 share half

**AC:**

- [ ] `updateShare` notifies newly added member sharees only
- [ ] Decision implemented: keep `docs.shared` for all paths **or** split `drive.shared` for non-`.md`
- [ ] Feature tests for create + update delta; no notify on revoke-only

**Non-goals:** public-link guests; email #553

#### T3 — Calendar RSVP organizer notify

**Title:** `[Task] Calendar RSVP reply → organizer suite inbox`

**Parent:** new Epic; Goal #390

**AC:**

- [ ] Local iTIP `REPLY` in `deliverLocal` fans `calendar.rsvp` to organizer (covers scheduleAfterWrite paths)
- [ ] PARTSTAT supersede; CANCEL does not create RSVP row; guest iMIP organizer-as-writer skipped
- [ ] Formatters + feature tests

**Non-goals:** replacing schedule-inbox; iMIP-only external reply email UX (#491)

#### T4 — Collection access granted notify

**Title:** `[Task] Calendar/Notes/Tasks shareWith → access-granted inbox`

**Parent:** new Epic; related #559 / #661

**AC:**

- [ ] Shared helper diffs added sharees after `CalendarShareInvites::apply`
- [ ] Actions `calendar.shared`, `notes.shared`, `tasks.list_shared` allow-listed
- [ ] Create-with-shareWith and patch both notify; revoke does not
- [ ] Navigate `/calendar` | `/notes` | `/tasks`

**Non-goals:** address-book shares; Drive file shares (T2)

#### T5 — Task status changed notify

**Title:** `[Task] Task status change by someone else → suite inbox`

**Parent:** new Epic; Goal #390

**AC:**

- [ ] STATUS transition on `TaskRepository` update/patch fires `tasks.status_changed`
- [ ] Recipients match agreed product rule; actor excluded
- [ ] Formatters + tests (complete / reopen)

**Non-goals:** task comment threads (#660); assignment-only Goal #563 unless chosen as recipient rule

#### T6 — Meet started notify

**Title:** `[Task] Meet room activated → suite inbox`

**Parent:** new Epic; related #686

**AC:**

- [ ] First `markActivated` fires `meet.started` once per room
- [ ] Recipients match agreed product rule
- [ ] Navigate includes room; formatters + tests

**Non-goals:** recording (#577); guest password (#578)

#### T7 — Chat mention persistence + notify

**Title:** `[Task] Persist chat mentions and notify mentioned users`

**Parent:** new Epic; related #686

**AC:**

- [ ] `ChatMessageRepository::create` accepts/stores validated mentions (OpenAPI already has shape)
- [ ] `chat.mentioned` allow-listed; mentioned users notified; author excluded
- [ ] Presentation no longer hard-codes `mentions: []`
- [ ] Formatters + feature tests

**Non-goals:** Docs mentions (#549 / T-mention); mention-only preference UI

#### T-mention (optional separate under #549)

**Title:** `[Task] Docs comment @mention storage and notify`

**Parent:** Goal #549 (or Epic if Docs-scoped epic preferred)

**AC:** mention chip in comment → persisted → `docs.mentioned` inbox

#### C-prefs (optional Chore — file only after expansion Epic exists)

**Title:** `[Chore] Track per-event inbox/push delivery preferences`

**Parent:** new expansion Epic (above) — **not** #741; **do not** file until that Epic exists

**Purpose:** Tracking placeholder for a later prefs pass. Not a delivery slice of producer expansion.

**Acceptance criteria (when implemented later — not this Chore’s body of work):**

- [ ] Preference key `(principal, domain.action, channel)` with `channel` = `inbox` | `push`
- [ ] Defaults documented in architecture (both on unless product overrides alarms)
- [ ] Evaluate at `NotifyListener` (inbox) and `VapidPushService` / delivery schedule (push)
- [ ] Support inbox-off/push-on without requiring a tray-visible row (schema seam TBD)
- [ ] No mute/digest/quiet-hours in v1 prefs

**Non-goals for filing now:** prefs table migration, settings UI, OpenAPI, large Epic.

**Until filed:** architecture + this plan section are the source of truth.

---

## Mapping: request → chunk → draft Task

| User request | Chunk | Draft issue |
|--------------|-------|-------------|
| Collaborator mention/reply | A (+ B for mention) | T1 + T-mention |
| Doc owner new thread | A | T1 |
| Drive shared with me | C (exists; refine) | T2 |
| RSVP update | D | T3 |
| Calendar access granted | E | T4 |
| Meeting started | G | T6 |
| Mentioned in chat | H | T7 |
| Notebook access granted | E | T4 |
| List access granted | E | T4 |
| Task status changed | F | T5 |

---

## Next steps for maintainers

1. Answer clarifications (especially Drive split, Meet/task recipients, Docs collaborator scope).
2. Confirm Goal parenting (#390 vs additional Goals).
3. `gh issue create` Epic + Tasks from drafts (English); then add `.agents/specs/<epic-or-first-task>-suite-notify-expansion/{spec,plan,tasks}.md` with `Source:` + body-hash.
4. Optionally file **C-prefs** Chore under the new Epic only (tracking; no prefs implementation in producer chunks).
5. Implement Chunk A first on `feat/suite-notify` or a follow-up `feat/` branch.
