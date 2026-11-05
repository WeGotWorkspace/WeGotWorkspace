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
 * PUSH_USER may list several accounts that share PUSH_PASSWORD (`a,b,c`): the
 * browsers spread over them, because one account allows 300 push requests a
 * minute. PUSH_INTERVAL_MS makes every browser reconnect at that interval
 * instead of the server's `retry:`, the way a browser with a linked presence
 * mesh waits 5 s while the server says 3 s (#1943). FPM_STATUS_URL (a PHP-FPM
 * `pm.status_path`, for example `https://example.test/fpm-status`) adds a
 * sampler that reports busy FPM children as `fpm_busy_children`.
 *
 *   k6 run -e BASE_URL=https://example.test -e PUSH_USER=load -e PUSH_PASSWORD=... \
 *     tools/load/rtc-shared-hosting.k6.js
 *
 * Urgent Web Push (#1670) joins when URGENT_USER / URGENT_PASSWORD (who starts
 * the meetings) and URGENT_RECIPIENT / URGENT_RECIPIENT_PASSWORD name two test
 * accounts. Each iteration gives the recipient URGENT_SUBSCRIPTIONS push
 * subscriptions, starts a new meeting, and right after its response sends a
 * cheap probe request. On a server with ONE PHP worker the probe waits until
 * the after-response send is done, so `urgent_worker_busy_ms` is how long a
 * worker stays busy for one meeting start. The subscriptions point at a real
 * push service (FCM) with made-up tokens: every send is a real TLS round trip
 * that the push service refuses, and the server prunes them again. Set
 * URGENT_ONLY=1 to run this scenario alone.
 *
 *   k6 run -e BASE_URL=http://127.0.0.1:9271 -e URGENT_ONLY=1 \
 *     -e URGENT_USER=admin -e URGENT_PASSWORD=... \
 *     -e URGENT_RECIPIENT=member -e URGENT_RECIPIENT_PASSWORD=... \
 *     -e URGENT_SUBSCRIPTIONS=20 tools/load/rtc-shared-hosting.k6.js
 *
 * Sizing table: docs/realtime-capacity.md
 */
import http from "k6/http";
import encoding from "k6/encoding";
import { check, sleep } from "k6";
import { Counter, Trend } from "k6/metrics";

const base = (__ENV.BASE_URL || "http://127.0.0.1:9080").replace(/\/$/, "");
const presenceUsers = Number(__ENV.PRESENCE_USERS || 8);
const pushUsers = (__ENV.PUSH_USER || "")
  .split(",")
  .map((name) => name.trim())
  .filter((name) => name !== "");
// Writes and their folder belong to the first account.
const pushUser = pushUsers[0] || "";
const pushPassword = __ENV.PUSH_PASSWORD || "";
const pushEnabled = pushUser !== "" && pushPassword !== "";
const pushIntervalMs = Number(__ENV.PUSH_INTERVAL_MS || 0);
const fpmStatusUrl = __ENV.FPM_STATUS_URL || "";
const pushOnly = __ENV.PUSH_ONLY === "1";
const pushBrowsers = Number(__ENV.PUSH_BROWSERS || 16);
const pushBatchSize = Number(__ENV.PUSH_BATCH_SIZE || 10);
const pushDuration = __ENV.PUSH_DURATION || "2m";
const pushFolder = "push-load";
const urgentUser = __ENV.URGENT_USER || "";
const urgentPassword = __ENV.URGENT_PASSWORD || "";
const urgentRecipient = __ENV.URGENT_RECIPIENT || "";
const urgentRecipientPassword = __ENV.URGENT_RECIPIENT_PASSWORD || "";
const urgentEnabled =
  urgentUser !== "" &&
  urgentPassword !== "" &&
  urgentRecipient !== "" &&
  urgentRecipientPassword !== "";
const urgentOnly = __ENV.URGENT_ONLY === "1";
const urgentSubscriptions = Number(__ENV.URGENT_SUBSCRIPTIONS || 20);
const urgentIterations = Number(__ENV.URGENT_ITERATIONS || 10);
/**
 * A fresh P-256 key and auth secret, so the server can encrypt every payload.
 * Made per run: nothing secret-looking lives in the repo.
 */
async function urgentSubscriptionKeys() {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
  const raw = await crypto.subtle.exportKey("raw", pair.publicKey);
  return {
    p256dh: encoding.b64encode(raw, "rawurl"),
    auth: encoding.b64encode(
      crypto.getRandomValues(new Uint8Array(16)).buffer,
      "rawurl",
    ),
  };
}

const pushRequest = new Trend("push_request_ms", true);
const pushRequests = new Counter("push_requests");
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
const fpmBusyChildren = new Trend("fpm_busy_children");
const driveWriteSingle = new Trend("drive_write_single_ms", true);
const driveWriteBatch = new Trend("drive_write_batch_ms", true);
const urgentWrite = new Trend("urgent_write_ms", true);
const urgentProbe = new Trend("urgent_probe_ms", true);
const urgentWorkerBusy = new Trend("urgent_worker_busy_ms", true);

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
      ...(fpmStatusUrl
        ? {
            fpmStatus: {
              executor: "constant-vus",
              vus: 1,
              duration: pushDuration,
              exec: "fpmStatus",
            },
          }
        : {}),
    }
  : {};

const urgentScenarios = urgentEnabled
  ? {
      urgent: {
        executor: "per-vu-iterations",
        vus: 1,
        iterations: urgentIterations,
        exec: "urgent",
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
  scenarios: urgentOnly
    ? urgentScenarios
    : pushOnly
      ? pushScenarios
      : { ...rtcScenarios, ...pushScenarios, ...urgentScenarios },
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
    {
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    },
  );
  check(join, {
    "join accepted": (res) => res.status === 200 || res.status === 201,
  });
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
    check(poll, {
      "poll ok": (res) => res.status === 200 || res.status === 204,
    });
    sleep(pollSeconds);
  }
}

function login(username, password) {
  const res = http.post(
    `${base}/api/v1/auth/token`,
    JSON.stringify({ username, password }),
    {
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    },
  );
  check(res, { [`login ${username} ok`]: (r) => r.status === 200 });
  return res.json("access_token");
}

function bearer(token) {
  return {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
  };
}

/** Time of a request on an idle worker, to subtract from the probe. */
function probeBaseline() {
  const samples = [];
  for (let i = 0; i < 5; i += 1) {
    samples.push(http.get(`${base}/api/v1/health`).timings.duration);
  }
  samples.sort((a, b) => a - b);
  return samples[2];
}

export async function setup() {
  const urgent = urgentEnabled
    ? {
        actorToken: login(urgentUser, urgentPassword),
        recipientToken: login(urgentRecipient, urgentRecipientPassword),
        probeBaselineMs: probeBaseline(),
        keys: await urgentSubscriptionKeys(),
      }
    : null;
  if (!pushEnabled) {
    return { urgent };
  }
  const tokens = pushUsers.map((name) => login(name, pushPassword));
  const token = tokens[0];
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

  return { token, tokens, basic, folderId: folder ? folder.id : null, urgent };
}

/**
 * One meeting start for a recipient with URGENT_SUBSCRIPTIONS subscriptions.
 * Only the join that starts the meeting and the probe right after it count.
 */
export function urgent(data) {
  const { actorToken, recipientToken, probeBaselineMs, keys } = data.urgent;
  for (let i = 0; i < urgentSubscriptions; i += 1) {
    const sub = http.post(
      `${base}/api/v1/notifications/push/subscriptions`,
      JSON.stringify({
        endpoint: `https://fcm.googleapis.com/fcm/send/wgw-load-test-${i}`,
        keys,
      }),
      bearer(recipientToken),
    );
    check(sub, { "urgent subscribe ok": (res) => res.status === 201 });
  }
  const channel = http.post(
    `${base}/api/v1/chat/channels`,
    JSON.stringify({
      name: `urgent-load-${__ITER}-${Date.now()}`,
      kind: "meeting",
    }),
    bearer(actorToken),
  );
  check(channel, { "urgent channel ok": (res) => res.status === 201 });
  const room = channel.json("id");
  http.patch(
    `${base}/api/v1/chat/channels/${room}`,
    JSON.stringify({ shareWith: { [urgentRecipient]: { mayWriteAll: true } } }),
    bearer(actorToken),
  );
  http.post(
    `${base}/api/v1/meetings/rooms`,
    JSON.stringify({ room, ownerPrincipal: `u:${urgentUser}` }),
    bearer(actorToken),
  );

  const started = Date.now();
  const join = http.post(
    `${base}/api/v1/rooms/${encodeURIComponent(room)}/participants`,
    JSON.stringify({ peerId: `urgent-${__ITER}`, name: "Load" }),
    bearer(actorToken),
  );
  check(join, { "urgent meeting start ok": (res) => res.status === 200 });
  const probe = http.get(`${base}/api/v1/health`);
  const busy = Date.now() - started - probeBaselineMs;
  urgentWrite.add(join.timings.duration);
  urgentProbe.add(probe.timings.duration);
  urgentWorkerBusy.add(Math.max(0, busy));
  sleep(1);
}

// Per-VU state: each VU is one browser with its own id and Last-Event-ID.
let lastEventId = null;

export function push(data) {
  if (__ITER === 0) {
    // Real browsers open at random moments; without this every VU would fire in step.
    sleep((Math.random() * (pushIntervalMs || 3000)) / 1000);
  }
  const headers = {
    Authorization: `Bearer ${data.tokens[(__VU - 1) % data.tokens.length]}`,
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
  pushRequests.add(1);
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
  } else if (pushIntervalMs > 0) {
    retryMs = pushIntervalMs;
  }
  sleep(retryMs / 1000);
}

/**
 * Busy FPM children four times a second. The status request itself takes a
 * child, so one is subtracted.
 */
export function fpmStatus() {
  const res = http.get(`${fpmStatusUrl}?json`, {
    tags: { name: "fpm-status" },
  });
  if (res.status === 200) {
    fpmBusyChildren.add(Math.max(0, Number(res.json("active processes")) - 1));
  }
  sleep(0.25);
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
