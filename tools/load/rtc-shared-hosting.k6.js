/**
 * Shared-hosting capacity script for PHP-FPM pm.max_children = 5.
 *
 * Simulates presence, two Docs rooms, and one call, then a 10-peer join burst
 * and a 10th participant. Signaling only: the browser's ICE work is not PHP.
 *
 *   k6 run -e BASE_URL=https://example.test tools/load/rtc-shared-hosting.k6.js
 *
 * JMAP push (#1660) joins the mix when PUSH_USER and PUSH_PASSWORD name a test
 * account: PUSH_BROWSERS browsers read the event source every retry, while
 * single Drive writes (WebDAV PUT) and batch writes (one FileNode/set with
 * PUSH_BATCH_SIZE creates) bump the root markers. Set PUSH_ONLY=1 to run the
 * push scenarios alone. Per-source state timings need
 * WGW_JMAP_PUSH_SERVER_TIMING=1 on the server (Server-Timing header).
 *
 *   k6 run -e BASE_URL=https://example.test -e PUSH_USER=load -e PUSH_PASSWORD=... \
 *     tools/load/rtc-shared-hosting.k6.js
 *
 * Sizing table: docs/realtime-capacity.md
 */
import http from "k6/http";
import encoding from "k6/encoding";
import { check, sleep } from "k6";
import { Trend } from "k6/metrics";

const base = (__ENV.BASE_URL || "http://127.0.0.1:9080").replace(/\/$/, "");
const presenceUsers = Number(__ENV.PRESENCE_USERS || 8);
const pushUser = __ENV.PUSH_USER || "";
const pushPassword = __ENV.PUSH_PASSWORD || "";
const pushEnabled = pushUser !== "" && pushPassword !== "";
const pushOnly = __ENV.PUSH_ONLY === "1";
const pushBrowsers = Number(__ENV.PUSH_BROWSERS || 16);
const pushBatchSize = Number(__ENV.PUSH_BATCH_SIZE || 10);
const pushDuration = __ENV.PUSH_DURATION || "2m";
const pushFolder = "push-load";

const pushRequest = new Trend("push_request_ms", true);
const pushStateBySource = {};
for (const source of [
  "notes",
  "calendars",
  "contacts",
  "chat",
  "files",
  "tasks",
  "inbox",
]) {
  pushStateBySource[source] = new Trend(`push_state_${source}_ms`, true);
}
const driveWriteSingle = new Trend("drive_write_single_ms", true);
const driveWriteBatch = new Trend("drive_write_batch_ms", true);

const pushScenarios = pushEnabled
  ? {
      push: {
        executor: "constant-vus",
        vus: pushBrowsers,
        duration: pushDuration,
        exec: "push",
      },
      driveWrite: {
        executor: "constant-arrival-rate",
        rate: 12,
        timeUnit: "1m",
        duration: pushDuration,
        preAllocatedVUs: 2,
        exec: "driveWrite",
      },
      driveBatch: {
        executor: "constant-arrival-rate",
        rate: 2,
        timeUnit: "1m",
        duration: pushDuration,
        preAllocatedVUs: 1,
        exec: "driveBatch",
      },
    }
  : {};

const rtcScenarios = {
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
};

export const options = {
  scenarios: pushOnly ? pushScenarios : { ...rtcScenarios, ...pushScenarios },
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
    peerId = join.json("peerId") || peerId;
  } catch {
    // Non-JSON join body: the local name remains the peer id.
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

export function setup() {
  if (!pushEnabled) {
    return {};
  }
  const login = http.post(
    `${base}/api/v1/auth/token`,
    JSON.stringify({ username: pushUser, password: pushPassword }),
    {
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    },
  );
  check(login, { "push login ok": (res) => res.status === 200 });
  const token = login.json("access_token");
  const basic = `Basic ${encoding.b64encode(`${pushUser}:${pushPassword}`)}`;
  http.request("MKCOL", `${base}/files/users/${pushUser}/${pushFolder}`, null, {
    headers: { Authorization: basic },
  });
  const nodes = jmap(token, [
    ["FileNode/get", { accountId: pushUser, ids: null }, "c0"],
  ]);
  const folder = (nodes.json("methodResponses.0.1.list") || []).find(
    (node) => node.name === pushFolder,
  );

  return { token, basic, folderId: folder ? folder.id : null };
}

// Per-VU state: each VU is one browser with its own id and Last-Event-ID.
let lastEventId = null;

export function push(data) {
  const headers = {
    Authorization: `Bearer ${data.token}`,
    Accept: "text/event-stream",
    "X-WGW-Browser-Id": __VU.toString(16).padStart(32, "0"),
  };
  if (lastEventId !== null) {
    headers["Last-Event-ID"] = lastEventId;
  }
  const res = http.get(`${base}/api/v1/jmap/events/*/state/0`, {
    headers,
    tags: { name: "jmap-events" },
  });
  check(res, { "push ok": (r) => r.status === 200 });
  pushRequest.add(res.timings.duration);
  for (const part of String(res.headers["Server-Timing"] || "").split(",")) {
    const match = part.trim().match(/^([a-z]+);dur=([0-9.]+)$/);
    if (match && pushStateBySource[match[1]]) {
      pushStateBySource[match[1]].add(Number(match[2]));
    }
  }
  let retryMs = 3000;
  for (const line of String(res.body || "").split("\n")) {
    if (line.startsWith("id: ")) {
      lastEventId = line.slice(4);
    } else if (line.startsWith("retry: ")) {
      retryMs = Number(line.slice(7)) || retryMs;
    }
  }
  if (res.status === 429) {
    retryMs = Number(res.headers["Retry-After"] || 3) * 1000;
  }
  sleep(retryMs / 1000);
}

export function driveWrite(data) {
  const res = http.put(
    `${base}/files/users/${pushUser}/${pushFolder}/single-${__VU}-${__ITER}.txt`,
    `push load ${Date.now()}`,
    {
      headers: { Authorization: data.basic, "Content-Type": "text/plain" },
      tags: { name: "drive-put" },
    },
  );
  check(res, { "drive put ok": (r) => r.status === 201 || r.status === 204 });
  driveWriteSingle.add(res.timings.duration);
}

export function driveBatch(data) {
  if (!data.folderId) {
    return;
  }
  const create = {};
  for (let i = 0; i < pushBatchSize; i += 1) {
    const upload = http.post(
      `${base}/api/v1/jmap/upload/${pushUser}`,
      `batch ${__ITER}-${i}`,
      {
        headers: {
          Authorization: `Bearer ${data.token}`,
          "Content-Type": "text/plain",
        },
        tags: { name: "jmap-upload" },
      },
    );
    create[`f${i}`] = {
      parentId: data.folderId,
      name: `batch-${__VU}-${__ITER}-${i}.txt`,
      blobId: upload.json("blobId"),
    };
  }
  const res = jmap(data.token, [
    ["FileNode/set", { accountId: pushUser, create }, "c0"],
  ]);
  check(res, { "drive batch ok": (r) => r.status === 200 });
  driveWriteBatch.add(res.timings.duration);
}

function jmap(token, methodCalls) {
  return http.post(
    `${base}/api/v1/jmap`,
    JSON.stringify({
      using: ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:filenode"],
      methodCalls,
    }),
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      tags: { name: "jmap" },
    },
  );
}
