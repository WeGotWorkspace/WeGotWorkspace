/**
 * Shared-hosting capacity script for PHP-FPM pm.max_children = 5.
 *
 * Simulates presence, two Docs rooms, and one call, then a 10-peer join burst
 * and a 10th participant. Signaling only: the browser's ICE work is not PHP.
 *
 *   k6 run -e BASE_URL=https://example.test tools/load/rtc-shared-hosting.k6.js
 *
 * Sizing table: docs/realtime-capacity.md
 */
import http from "k6/http";
import { check, sleep } from "k6";

const base = (__ENV.BASE_URL || "http://127.0.0.1:9080").replace(/\/$/, "");
const presenceUsers = Number(__ENV.PRESENCE_USERS || 8);

export const options = {
  scenarios: {
    presence: {
      executor: "constant-vus",
      vus: presenceUsers,
      duration: "2m",
      exec: "presence",
    },
    docs: {
      executor: "constant-vus",
      vus: 4,
      duration: "2m",
      exec: "docs",
    },
    call: {
      executor: "constant-vus",
      vus: 4,
      duration: "2m",
      exec: "call",
    },
    joinBurst: {
      executor: "shared-iterations",
      vus: 10,
      iterations: 10,
      startTime: "20s",
      maxDuration: "30s",
      exec: "joinBurst",
    },
    tenthParticipant: {
      executor: "per-vu-iterations",
      vus: 1,
      iterations: 1,
      startTime: "50s",
      exec: "tenthParticipant",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.05"],
  },
};

export function presence() {
  session("p_workspace", `presence-${__VU}`, 1.2);
}

export function docs() {
  const rooms = ["f_ZG9jcy9jYXBhY2l0eS1hLm1k", "f_ZG9jcy9jYXBhY2l0eS1iLm1k"];
  session(rooms[(__VU - 1) % rooms.length], `docs-${__VU}`, 15);
}

export function call() {
  session("capacity-call", `call-${__VU}`, 4);
}

export function joinBurst() {
  session(`burst-${__ITER}`, `burst-${__VU}`, 0.4, 1);
}

export function tenthParticipant() {
  session("capacity-call", "call-10", 0.4, 8);
}

function session(room, name, pollSeconds, polls = 4) {
  const join = http.post(
    `${base}/api/v1/rooms/${encodeURIComponent(room)}/participants`,
    JSON.stringify({ room, name }),
    { headers: { "Content-Type": "application/json", Accept: "application/json" } },
  );
  check(join, { "join accepted": (res) => res.status === 200 || res.status === 201 });
  let peerId = name;
  try {
    peerId = join.json("peerId") || name;
  } catch {
    peerId = name;
  }
  for (let i = 0; i < polls; i += 1) {
    const poll = http.get(
      `${base}/api/v1/rooms/${encodeURIComponent(room)}/events?peerId=${encodeURIComponent(peerId)}`,
      { headers: { Accept: "application/json" } },
    );
    check(poll, { "poll ok": (res) => res.status === 200 || res.status === 204 });
    sleep(pollSeconds);
  }
}
