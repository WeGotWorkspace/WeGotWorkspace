# Calendar invitee picker from Contacts

Derived from [spec.md](./spec.md).

## Goal

Let a signed-in user search and select a Contacts person while adding event invitees. The pick becomes a normal attendee (email + name) so instance RSVP (#478) and external iMIP (#479) stay unchanged.

## Non-goals

- Invite protocol / OpenAPI / Mail compose picker / group-card expand / Sabre group invitees / group address books — see spec

## Affected packages

- `packages/apps` only

## Dependencies

1. Chunk **A** (pure mapping) has no Calendar workspace dependency — start here.
2. Chunk **B** (load cards in Calendar) can run **with A**.
3. Chunk **C** needs A + B (or mocked card props) before wiring the dropdown.
4. Chunk **V** after A–C merge.

## Chunks

### Chunk A: Contact → attendee mapping

- **id:** `contact-attendee-map`
- **Skill:** apps-ui, testing
- **Inputs:** `normalizeParticipantAddress` / `attendeesReferToSamePerson` in `calendar-attendees.ts`; `contacts-display-utils.ts` (`collectEmails` is private today)
- **Done when:**
  - `contactInviteEmails(card)` returns unique normalized addresses + context labels (intra-card dedup; no Work/`pref` auto-pick)
  - `findInviteeForAddress` / `contactEmailToAttendee` use **only** the passed `invitees[]` (same array as teammate rows)
  - Tests cover case/trim/`mailto:` equality, schedulingAddresses **include and omit**, duplicate emails on one card, invitee **alias**, invitees-hit → `inviteeAddress`, invitees-empty → **`rawEmail` casing kept**
  - Existing attendee `Jane@Host` vs contact `jane@host` → omit via normalize (not rawEmail equality)
  - `typedEmailSearchRow` emits `source: "typed-email"`, namespaced `id`, `rawEmail` + normalized `email`
  - `id` namespaced and unique; unknown context → `contactContext === undefined`
  - `CalendarInviteeSearchRow.source` is the teammate/contact discriminator
  - Group cards and cards without email yield no rows
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/contacts-core/src/contacts-display-utils.test.ts src/calendar-core/src/calendar-contact-attendee.test.ts`
- **Parallel with:** `calendar-contact-load`

### Chunk B: Load Contacts in Calendar (no ContactsApp)

- **id:** `calendar-contact-load`
- **Skill:** workspace
- **Inputs:** `readContactsBootstrapFromCache`, `listCards` / `getContactCardsByQuery`, `calendar-api-source.ts`, `calendar-workspace.tsx` / invitations hook
- **Done when:**
  - Calendar supplies `ContactCard[]` via `readContactsBootstrapFromCache` + `listCards` only (no `useContactsAPI` / ContactsApp)
  - Cache hit → cached cards
  - Cache empty + live ok → JMAP list
  - Cache empty + live throw (network / JMAP / expired session) → `[]`; teammates / typed email unchanged
  - Mock API source ships a multi-email contact
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/calendar-core/src/use-calendar-contact-invitees.test.tsx` (or equivalent hook/source test)
- **Parallel with:** `contact-attendee-map`

### Chunk C: Invitees card UI + stories

- **id:** `calendar-contact-picker-ui`
- **Skill:** workspace, apps-ui, storybook, accessibility
- **Inputs:** A + B; `calendar-invitees-card.tsx`, `calendar-event-dialog.tsx`, `calendar-labels.ts`, `calendar-event-dialog.stories.tsx`
- **Done when:**
  - Search merges teammate + contact + `typedEmailSearchRow`
  - `rg EMAIL_OPTION_PREFIX packages/apps` is empty (no leftover `"email:"` option-id parsers in card, analytics, other dialogs, or serializers)
  - Select contact with `rawEmail: "Jane@Host"` → `CalendarAttendee.email === "Jane@Host"` (not the normalized key)
  - Branch on `CalendarInviteeSearchRow.source` only; map to label meta; Vitest asserts **exact** default-label strings
  - Same-email teammate + contact is one row (teammate); other emails on that card still show
  - Dialog Vitest covers add-from-contact (work vs home), typed-email via new row shape, skip no-email/group, no duplicate
  - Mock-tier Storybook story exercises contact hits
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/calendar-core/src/calendar-event-dialog.test.tsx src/calendar-core/src/calendar-invitees-card.css.test.ts`
- **Parallel with:** none (after A+B)

### Chunk V: Verify

- **id:** `verify-calendar-contact-picker`
- **Skill:** testing, verify-issue, code-review
- **Inputs:** merged A–C; Task #638; Goal #568 success signals
- **Done when:** verify-issue PASS or PASS_WITH_NITS on #638; Goal #568 success signals observable; `pnpm test:apps-done-gate`; smells on touched files
- **Verify with:** [verify-issue](../../skills/verify-issue/SKILL.md) (Task mode on #638; Goal mode on #568), `pnpm test:apps-done-gate`
- **Parallel with:** none

## Test plan

- [ ] Pure lib: normalize (case/trim/mailto), intra-card dedup, findInviteeForAddress vs passed invitees[] only, skip group/no-email
- [ ] Hook / API source: cache-hit, cache-empty+live ok, cache-empty+live fail → []
- [ ] Dialog RTL: search/select contact; teammate and typed-email paths still work
- [ ] Mock-tier Storybook for event dialog with contact hits
- [ ] `pnpm test:apps-done-gate`
- [ ] verify-issue on #638; product check of Goal #568 success signals (no new API gate)

## Doc updates (only if user wants)

- None unless asked. Goal #568 Delivery already points at #638 and this spec folder.
