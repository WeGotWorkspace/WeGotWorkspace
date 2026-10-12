Source: #1095 (body-hash: 8f739aae)
Goal: #1082

# Docs live sync over HTTP

When a collab data channel does not open, local Yjs updates travel on the existing room mailbox as `yjs` and `yjs-sv`. The client reuses the network probe and `requestRelay`. A newcomer still loads the server snapshot; the mailbox only carries state-vector diffs.

## Goal

Keep two Docs editors in sync on a network where WebRTC cannot connect, without waiting on TURN, and tell an admin when that path is the slow one.

## Non-goals

- Server-side Yjs merging.
- WebSockets.
- Changing the OpenAPI `yjs` / `yjs-sv` contract.
- The Meet relay banner (#1094) or the daily admin notification (#1096).

## Affected packages

- packages/api
- packages/apps

## Technical constraints

- `to: "*"` is accepted only for `type: "yjs"` and becomes one mailbox row per other peer.
- A peer whose stored access is `read` receives `403 forbidden` for `yjs`. `yjs-sv` stays allowed.
- Each encoded payload is at most 64 KiB. The client splits a larger update into updates the receiver can apply on arrival.
- At most 10 `yjs` or `yjs-sv` sends per peer per second (`429` above that).
- Collab joins advertise `yjs-http` and `relay-jit`. Traffic goes only to peers that advertise the matching cap.
- HTTP updates start after 5 seconds without a data channel, or immediately when relay is forced and TURN is not configured, or when the network probe says the path cannot be direct.
- A relay request goes out at 8 seconds, or immediately in that same unavailable case. `503` stays on HTTP. Credentials retry the data channel and HTTP stops once it opens.
- While any peer is on HTTP, the room poll interval is at most 1 second.
- Local-origin updates only. `isRemoteUpdateOrigin` still drops remote echoes.
- State-vector resync on fallback start and every 30 seconds, including the data-channel path.

## Edge cases

- A reader may request a diff and must not publish one.
- Duplicate, delayed, and dropped mailbox updates converge after a state-vector resync.
- Non-admins never see Set up. SaaS copy replaces the TURN sentence when relay is part of the service.
