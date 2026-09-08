Source: ad-hoc

# RTC cross-app connection optimization

Technical translation of the approved plan "WebRTC connection optimization — implementation plan (final scope)" (`rtc_cross-app_verbeteringen_9e306e09`). Covers phases 0–3a; phases 3b/4 are go/no-go gated and out of this spec.

## Goal

Improve WebRTC connection behavior across the suite in ordered phases: (0) close the collab-join authorization gap so only principals with access to a document/note can join its signaling room; (1) keep the Meet call alive across app switches, cut idle poll cost, and verify STUN in production; (2) add a collab mesh linger grace period and gossip peer discovery over the collab data-channel envelope; (3a) introduce a `principal` room kind (backend prefix + policy + tables + service, frontend presence/chat/typing with eager desktop join).

## Non-goals

- Accepting external share-session tokens (`DriveShareSessionsController`) on collab join — documented later iteration.
- Cross-room connection reuse (phase 3b) and cross-window leadership (phase 4) — phase 3b landed in #690; phase 4 tracked as #695 / `.agents/specs/695-rtc-cross-window-leader/`.
- SFU/TURN infra, media renegotiation (`addTrack`), shared/rotated poller.
- New REST endpoints for phase 0 (enforcement happens inside the existing join flow).

## Affected packages

- packages/api — collab signaling authorization (phase 0), poll conditional response (phase 1), principal room kind (phase 3a)
- packages/apps — Meet suite-level call store + mini-player, poll visibility backoff (phase 1), collab linger + gossip (phase 2), principal mesh UI (phase 3a)

## Technical constraints

- Phase 0 enforcement point is `DocCollabSignalingService::join` (poll/send/leave already bind to peer ownership via `assertPeerOwnedByActor`).
- Decoded collab rooms are opaque strings with two known shapes: drive virtual path (leading `/`, e.g. `/users/bob/doc.md`) and note VJOURNAL UID (no `/`, minted UUID — `encodeNoteRoomId` in `packages/apps/src/notes-core/src/note-collab-path.ts`). A server-side discriminator must dispatch: path-like → drive home/share check (`DriveShareAuthorizer`); UID-like → notebook ownership/sharing (`NoteRepository::findAccessibleNote`); neither → default-deny.
- Reuse existing share/ownership services; no new storage or ACL tables for phase 0.
- Stay inside the service/policy layering (`.agents/skills/api/layers.md`): controllers stay thin, checks live in `app/Services/Collab/`.
- Feature tests extend `Tests\Support\WgwDatabaseTestCase`; drive fixtures via `DriveTestFixtures`, notebook sharing via notes REST (`shareWith`).

## Edge cases

- Room decodes to a path outside `/users/**` and `/groups/**` (e.g. legacy `docs/x.md` shape without leading slash) → deny.
- Note UID that does not exist (or local temp id) → deny; notes are created server-side before collab join, so live rooms always have a persisted UID.
- Group drive paths (`/groups/{slug}/…`) → allowed for group members via `StoragePaths::isPathAllowed`.
- Share grant revoked/expired → grant resolver returns nothing → deny.
- Guest share-session principals do not gain collab join in phase 0 (see non-goals).
