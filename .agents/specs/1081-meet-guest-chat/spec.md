Source: #1081 (body-hash: 47bec0fe)

# Live chat for guests in a Meet call

Technical translation of the task. Guests read room lines, not the member channel, so a chat frame on the open call reaches them without waiting for the idle poll.

## Goal

On every Meet peer connection, both sides open a negotiated data channel at construction. A chat line is sent on every open channel and always posted to the room. Receivers keep one line per sender and client id. HTTP remains the path when the channel is not open, and the path that records admit.

## Non-goals

- Channel history, reactions, threads, edit, and delete
- Remembering room lines across refresh
- Lobby HTTP fan-out (#1099) and the OpenAPI contracts owned by #1085
- An unreliable channel on id 2

## Affected packages

- packages/apps

## Technical constraints

- Channel label `meet`, negotiated, id 1, ordered. Id 2 stays unused.
- Join advertises cap `meet-dc`. Frames are JSON `{ "t": "<type>", ... }`. `t: "chat"` carries the client ULID, text, and timestamp. `vad`, `caps`, `rank`, and `sig` are ignored.
- The sender is the remote peer id of the connection. The display name comes from the roster. Dedupe is that pair plus the ULID, never the ULID alone.
- `sendRoomChat` is the seam a future media server replaces. `peer-mesh.ts` stays under 800 lines without a baseline raise.

## Edge cases

- A channel that is not open still produces one HTTP line.
- The same ULID from a different peer is a different line.
- Admit, and any other server-recorded control, is not applied from the data channel.
- A member's channel row still hides the room copy once that row is saved, so the call does not show the line twice.
