Source: #1096 (body-hash: d9cab46d)

Goal: #1082

# Real-time health metrics

Anonymous session samples land in `rtc_session_metrics`. Admins read p50/p95 join time, relay and fallback share, and relay outcomes on Real-time health. A bundled daily notice names who could not connect. A k6 script and a sizing table describe a PHP-FPM pool with `pm.max_children = 5`.

## Non-goals

- External telemetry.
- A new migration. `#1085` already created `rtc_session_metrics`, `rtc_relay_events`, and `POST /rtc/metrics`.
- Changing the sample schema. The wire channel stays `meet` or `collab` (`collab` is Docs). Presence is not a sample channel on that contract.

## Affected packages

- packages/api
- packages/apps
- docs
- tools/load

## Technical constraints

- Persist only the allow-list: channel, join time, candidate type, failed pairs, ICE restarts, HTTP fallback, poll RTT, net class. No IP, ICE address, SDP, ticket, room name, or user id.
- Auth is a bearer session or a guest session key that still owns a live peer row. A minted key is rejected.
- Rate limit: 30/minute per actor and 30/minute per address, so a caller-chosen session key cannot multiply inserts. The limit runs before the insert. The address key lives in the limiter cache, not in `rtc_session_metrics`.
- Body cap is 8 KiB, checked before a row is written. PHP has already buffered the request; `post_max_size` is the outer cap.
- Clients send at most one sample a minute. `peer-mesh.ts` stays at or under 800 lines.
- The admin notice is one row per admin per calendar day, via `notifications-core`. Copy is the count, usernames, and Meet, Docs, or Presence. No network class.
- The sizing table is the request rate implied by the poll cadence against five FPM children. It is not a stopwatch from a rented host. The k6 script is how to record one.

## Edge cases

- A sample with extra JSON fields is accepted only when the body is under 8 KiB, and those fields are dropped.
- TURN configured, or a week with no `unavailable` outcomes: the callout is absent.
- A second `unavailable` outcome the same day updates the existing notice.
- Presence meshes do not post a sample, because the contract has no presence channel.
