---
name: meet
description: Meet video calls and room signaling — Laravel MeetSignalingService, HTTP room session API, meet-core UI, and lib/rtc WebRTC stack. Use when working on meet, rooms, RTC, or collab signaling.
paths:
  - "packages/apps/src/meet-core/**"
  - "packages/apps/src/chat-ui/**"
  - "packages/apps/src/lib/rtc/**"
  - "packages/api/app/Services/Meet/**"
  - "packages/api/app/Http/Controllers/Api/V1/Rooms/**"
  - "packages/api/app/Http/Controllers/Api/V1/Meetings/**"
---

# Meet and RTC

Meet spans **Laravel signaling** (`packages/api`) and **browser RTC** (`packages/apps`). File collab (docs) shares room routes but uses a data-channel binding — see `lib/rtc/README.md`.

## Quick decision matrix

| Task | Read |
|------|------|
| HTTP routes / signaling service | `packages/api/docs/meet-signaling.md`, [api/rest-design.md](../api/rest-design.md) |
| WebRTC kernel (mesh, ICE, poll) | `packages/apps/src/lib/rtc/README.md` |
| Meet product UI | `packages/apps/src/meet-core/` |
| Storybook (offline) | [storybook/offline-first.md](../storybook/offline-first.md), `createMeetAppBootstrap` |
| Tests | [testing/ui-architecture.md](../testing/ui-architecture.md), `packages/api/docs/meet-signaling.md` |
| REST layering | [api/SKILL.md](../api/SKILL.md), [api/layers.md](../api/layers.md) |

## API (Laravel only)

Signaling lives in **`MeetSignalingService`** — not legacy `Voice/` or `packages/api/src/`.

| Component | Role |
|-----------|------|
| `app/Services/Meet/MeetSignalingService.php` | `meet_peers` / `meet_messages` on `wgw` |
| `app/Services/Meet/MeetActorResolver.php` | Guest `sessionKey`, authenticated owner |
| `app/Http/Controllers/Api/V1/Rooms/RoomSessionController.php` | `/rooms/{roomId}/*` |
| `app/Http/Controllers/Api/V1/Meetings/MeetingsController.php` | `/meetings/rooms` lifecycle |

Key routes: join/poll/send/leave on `/rooms/{roomId}/*`; chat on `POST …/messages`; RTC ICE on `GET …/configuration`. Full table: `packages/api/docs/meet-signaling.md`.

```bash
cd packages/api && composer test -- --filter Meet
pnpm test:meet-api
```

## UI stack

| Layer | Path |
|-------|------|
| App / workspace / panes | `meet-core/src/*-app.tsx`, `meet-workspace` (Split product), `meet-call-workspace` (live `/meet`), `meet-guest-channel`, `meet-*-pane.tsx` |
| Shared chat UI | `packages/apps/src/chat-ui/` — `Shared/Chat/*` stories (no RTC) |
| RTC session wrapper | `meet-core/src/meet-rtc-session.ts`, `use-meet-rtc.ts` |
| Shared RTC kernel | `lib/rtc/` — `createRtcSession`, `RtcPeerMesh`, `signaling/http-client.ts` |

**Controller rule:** product controllers own UX; **no `RTCPeerConnection` in controllers** — only in `lib/rtc` + thin `*-rtc-session.ts` wrappers.

### Meet invariants (do not break)

| Topic | Rule |
|-------|------|
| A/V | WebRTC media binding only |
| Chat + control | HTTP messages + poll — **not** data channels |
| Signaling | HTTP on `/api/v1/rooms/{roomId}/*` |
| Meet SDP | Sanitize **inbound remote** SDP only — never rewrite local before `setLocalDescription` |
| Initiator | Meet uses `higherId` (lexicographic peer id) |
| Guest tabs | Unauthenticated fetch + `sessionKey` on poll/send/chat |

**Poll cadence:** connecting 400 ms; active steady 1200 ms (chat, knock/admit, roster). When all media peers are connected and no knockers are waiting, meet idles at **4 s** — lighter than collab's 15 s idle backoff but still responsive for control messages.

Debug: `?rtcDebug=1` on URL. Relay-only dev: `?rtcForceRelay=1` or `VITE_WGW_RTC_FORCE_RELAY=1`.

## Storybook (mock-tier required)

`createMeetAppBootstrap` now includes `channels`, `messages`, `directory` principals, and a static `unfurl` map. Interactive harnesses use stub `createMeetChatOperations` (local state only — no live signaling).

| Surface | What to use |
|---------|-------------|
| New product shell | `Apps/Meet` — `MeetWorkspaceStoryHarness` (`meet-workspace.stories.harness.tsx`, stories in `meet-app.stories.tsx`): channels + chat + optional call |
| Shared chat primitives | `Shared/Chat/*` — message, list, composer, mentions, reactions, link previews, threads (product-agnostic; no RTC, no Meet CSS) |
| Guest stripped channel | `Apps/Meet/Panes/MeetGuestChannel` — checking / waiting / lobby / in-channel; no channel sidebar (`hideSidebarToggle`) |
| Live `/meet` | `MeetApp` still mounts `MeetCallWorkspace`; boot with `createMeetAppBootstrap` (`meet-app.stories.tsx` / `meet-call-workspace.stories.tsx`) |

```tsx
import { createMeetAppBootstrap } from "@/lib/api/mock/meet-bootstrap";

export const Default: Story = {
  args: { ...createMeetAppBootstrap(), onLogout: () => {} },
};
```

Do not call `useMeetRtc` from chat primitives. **`Live …`** stories need API + Docker — optional only ([storybook/offline-first.md](../storybook/offline-first.md)).

## Operations DI (tech debt)

Prefer **`operations`** on meet controllers over direct `@/lib/api/wgw/*` imports. Product vertical wired in [#77](https://github.com/WeGotWorkspace/wegotworkspace/pull/77).

## When unsure

- HTTP contract: `packages/api/openapi/openapi.json` + feature tests
- Client behavior: `lib/rtc/README.md` + existing Vitest under `meet-core/` and `lib/rtc/`
- Do not restore deleted legacy Voice PHP
