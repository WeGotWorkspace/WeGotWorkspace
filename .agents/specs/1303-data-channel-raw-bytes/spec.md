Source: #1303 (body-hash: 23114898)
Goal: #1082

# Raw Yjs bytes on the data channel

A framed data-channel message carries a short JSON header and, when the message has a payload, the Yjs bytes themselves. The number-array JSON encoding is gone from this path.

## Goal

Replace the UTF-8 JSON body (`u` as a number array) with one binary message: a big-endian uint16 header length, the JSON header, and a raw tail. Sync and awareness stay `Uint8Array` from encode through apply. Every peer is framed. The HTTP mailbox and the signaling caps stay as they are.

## Non-goals

- Base64 as a step on the data-channel path.
- Keeping a JSON-string send path.
- Changing the HTTP fallback, signaling advertisements, or sidecar snapshot storage.
- Changing the #1261 frame bounds.
- A second binary payload in one message.
- New dependencies, or a refactor of the rest of the RTC layer.

## Affected packages

- packages/apps

## Technical constraints

- One message is `[uint16 headerLen][UTF-8 JSON header][raw payload]`. The header is the old message without `u`. `bin: 1` marks a tail, including a tail of zero bytes. No `bin` and no extra bytes means `payload` is null.
- On a reuse envelope, `bin: 1` sits on the nested `payload`, not on the envelope.
- `headerLen` past the buffer is rejected. Frame reassembly still returns bytes. Bounds stay `PENDING_MESSAGE_TTL_MS` 30000, `MAX_PENDING_MESSAGES_PER_REMOTE` 4, `MAX_MESSAGE_FRAMES` 4096, `MAX_PENDING_BYTES_PER_REMOTE` 16 MiB.
- `caps` still includes `bin`. Framing no longer consults that cap. Collab still advertises `["bin", "yjs-http", "relay-jit"]` and principal still advertises `["bin"]`.
- Client-id lists (`changed`) stay `number[]`.
- A channel string does not become a message.

## Edge cases

- An empty tail (`bin: 1`, zero bytes) is distinct from a message with no payload (poke).
- A tail without `bin` is rejected.
- Invalid UTF-8 in the tail round-trips as bytes. The header stays UTF-8 JSON.
- A late joiner still receives the full document state after earlier peers have edited.
- Meet chat reads the JSON header and ignores the tail.
