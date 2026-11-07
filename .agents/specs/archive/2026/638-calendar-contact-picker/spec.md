Source: #638 (body-hash: 95e6ab84)
Goal: #568

# Calendar invitee picker from Contacts

Technical translation of Task [#638](https://github.com/WeGotWorkspace/wegotworkspace/issues/638). Product context: Goal [#568](https://github.com/WeGotWorkspace/wegotworkspace/issues/568) (pick a person from Contacts when inviting). Inviting itself is already shipped: same-instance RSVP ([#478](https://github.com/WeGotWorkspace/wegotworkspace/issues/478) / [480-calendar-scheduling](../480-calendar-scheduling/spec.md)) and external iMIP ([#479](https://github.com/WeGotWorkspace/wegotworkspace/issues/479) / [481-calendar-imip](../481-calendar-imip/spec.md)).

## Goal

Calendar’s event-dialog invitee search reads the user’s Contacts cards and lists **every email on a matching person/org card**. The chosen address **resolves to the existing `CalendarAttendee` email + name shape** so local iTIP and external iMIP keep working. No new invite protocol, and no contact UID on the event.

## Non-goals

- New iTIP / iMIP / scheduling-inbox work
- Mail compose picker (#572)
- Creating or editing contact cards (#383)
- Expanding JSContact group cards into many invitees
- Inviting Sabre group principals (`principals/groups/*`) — those stay calendar ACL share targets
- Group address books (#566) — picker uses whatever books bootstrap already returns
- Storing a contact UID on the JMAP participant
- New OpenAPI fields on `GET /calendars/scheduling/invitees`
- Mounting `ContactsApp` / `useContactsController` inside Calendar

## Affected packages

- `packages/apps` — `calendar-core` invitee card + mapping; `contacts-core` display helpers; Calendar API source / offline cache read
- `packages/api` — none expected (no OpenAPI change)

## Technical constraints

- **Resolve, do not persist identity.** `participantsFromAttendees()` stays email/name. Instance-user match uses **only** the same `CalendarInvitee[]` as teammate rows (`listInvitees`). One helper in `calendar-contact-attendee.ts` (`findInviteeForAddress`); no second principal lookup.
- **Email identity.** Every “same address?” check goes through `normalizeParticipantAddress` (trim, lower-case, strip `mailto:`). That value is the lookup key (`CalendarInviteeSearchRow.email`) only. The sent/stored attendee uses `rawEmail` (card/typed original, `mailto:` stripped, casing kept) or teammate `inviteeAddress`. Do not persist the lowercased key.
- **Do not mount Contacts.** `readContactsBootstrapFromCache` and `listCards` are plain async (Dexie / JMAP) — no Contacts Provider. Do not call `useContactsAPI`. Calendar passes session `username` so the Dexie account key matches. Cache empty + live throw → `cards = []` (teammates / typed email unchanged).
- **Search is client-side.** JMAP `ContactCard/query` has no text filter. Reuse `filterCardsBySearch` from `contacts-display-utils.ts`.
- **One row per email.** Do not auto-pick Work or `pref`. Explode matching individual/org cards into one option per address. Dedup **inside the card** after normalize (duplicate `emails[]` / `schedulingAddresses` mailto). Meta = Work / Home / other context, else the address.
- **Not inviteable.** Skip JSContact group cards (`isContactGroupCard`) and cards with no inviteable address. Do not expand group members.
- **Sabre groups.** Do not offer `principals/groups/*` as event invitees (ACL share only; invitees API already excludes them).
- **Search dedup.** After intra-card dedup, omit a contact-email row if that normalized address already appears as a teammate row or attendee. Other emails on the same card still show.
- **Search row contract.** `CalendarInviteeSearchRow`: `source` (only teammate/contact/typed-email identity); `email` (normalized key); `rawEmail` (sent value); `id` namespaced (`teammate:${email}` / `contact:${cardId}:${email}` / `typed-email:${email}`) so merged-list keys cannot collide; `contactContext` only `work` | `home` | `school`, else `undefined` (meta = `rawEmail`). Chunk A owns `typedEmailSearchRow(input)` — the old `email:` prefix path is replaced. Chunk C done-when includes `rg EMAIL_OPTION_PREFIX packages/apps` empty (no leftover parsers in card, analytics, other dialogs, or serializers). Chunk C maps `source` → labels and persists `rawEmail` / `inviteeAddress`. Do not parse meta; do not widen `SharePrincipalKind`. Omit vs existing attendees compares **normalized** attendee email, never raw string equality on `rawEmail`.
- **UI.** Extend `CalendarInviteesCard` + `SharePrincipalSearchDropdown`.
- **Copy.** Update `calendar-labels.ts` so the hint/empty state mention contacts, not only teammates.
- **CSS.** BEM + existing share-ui / invitees-card classes; no long Tailwind in TSX.
- **Test-first.** Pure mapping tests first, then dialog RTL, then mock-tier Storybook.

## Edge cases

- Multi-email contact → one dropdown row per address; user picks which to add
- Contact email matches an instance user → store `inviteeAddress(invitee)` so scheduling stays local
- Contact email matches an attendee already on the event → no-op
- Organizer / session user’s own card → exclude
- Empty Dexie + live `listCards` fails → empty contact list; teammates and typed email still work
- Empty Dexie + online success → live fetch, then client filter
- Same query hits teammate and contact with the same email (any case/`mailto:`) → one row (teammate)
- Same card lists the same address twice in `emails[]` → one exploded row
- `schedulingAddresses` mailto not in `emails[]` → its own exploded row
- Contact email matches invitee `username` (not `invitee.email`) → `findInviteeForAddress` hit, store `inviteeAddress`
- Invitees empty + card `Jane@Host` → attendee email is `Jane@Host`, not `jane@host`
- Unknown JSContact email context → `contactContext` is `undefined` (no throw, not `"other"`)
- Namespaced `id`s stay unique across teammate / contact / typed-email even when normalized addresses match
- Existing attendee `Jane@Host` + contact row `jane@host` → omit (normalize, not raw equality)
- Dialog select of contact `rawEmail: "Jane@Host"` → `CalendarAttendee.email === "Jane@Host"`
- After #566, extra books in bootstrap appear automatically; no picker-specific multi-book UI
