# Calendar iMIP and RSVP links

Derived from [spec.md](./spec.md).

## Goal

Outbound iMIP via MailDelivery plus HTTPS RSVP — closing Epic #481 under Goal #479.

## Non-goals

- Internal inbox UI (#478 / #480)
- Inbound Mail-app iMIP, inbox placement AC, second SMTP path

## Affected packages

- packages/api | packages/apps

## Dependencies

1. Epic #480 chunk **B** (`rest-itip-local`) — shared broker + local-vs-mailto routing.
2. Goal #471 / PR #475 merged — `MailDeliveryService`.
3. Chunk **E** after those; Calendar UI send-gating can follow #480 chunk D.
4. Chunk **V** after E.

## Chunks

### Chunk E: Outbound iMIP + RSVP

- **id:** `imip-rsvp`
- **Skill:** api, workspace, testing
- **Inputs:** MailDelivery, ITip schedule listeners, `UiStaticServer`, Task #486
- **Done when:** external mailto gets multipart iMIP; RSVP token accept/decline/tentative updates PARTSTAT; `canSubmit` false is visible; allowlist + feature tests; no `IMipPlugin::mail()`
- **Verify with:** `pnpm test:api-done-gate`; SPA allowlist test; targeted apps tests if UI gated
- **Parallel with:** none

### Chunk V: Verify

- **id:** `verify-calendar-imip`
- **Skill:** testing, verify-issue, code-review
- **Inputs:** merged E; Task #486; Epic #481
- **Done when:** verify-issue PASS or PASS_WITH_NITS on #481 / #486; done gates; smells on touched files
- **Verify with:** verify-issue, `pnpm test:api-done-gate`
- **Parallel with:** none

## Test plan

- [ ] API: Mail fake asserts `text/calendar; method=REQUEST` + RSVP URL; token accept updates PARTSTAT; expired token 4xx → `pnpm test:api-done-gate`
- [ ] Allowlist: `FrontRoutingTest` + `SpaShellRouteAllowlistTest` for `/calendar/rsvp`
- [ ] verify-issue against #486 / #481

## Doc updates (when implementing)

- `packages/api/docs/calendars/scheduling.md` — iMIP + RSVP section
- Point #471 docs at this consumer
