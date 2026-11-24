import { describe, expect, it } from "vitest";
import {
  classifyRequest,
  isGovernedClass,
  parseTrafficBudget,
  RequestGovernor,
  TRAFFIC_BUDGET_HEADER,
} from "./request-governor";

type Overrides = {
  status?: number;
  fail?: boolean;
  headers?: Record<string, string>;
  burst?: number;
};

function harness(overrides: Overrides = {}) {
  let clock = 0;
  const sent: string[] = [];
  const governor = new RequestGovernor({
    backgroundPerMinute: 30,
    burst: overrides.burst ?? 3,
    bulkPerMinute: 20,
    coalesceTtlMs: 15_000,
    maxWaitMs: 30_000,
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    fetch: async (request) => {
      sent.push(new URL(request.url).pathname);
      if (overrides.fail) throw new TypeError("Failed to fetch");
      return new Response("{}", { status: overrides.status ?? 200, headers: overrides.headers });
    },
  });
  return { governor, sent, advance: (ms: number) => (clock += ms), now: () => clock };
}

const get = (path: string, headers: Record<string, string> = {}) =>
  new Request(`https://suite.test/api/v1${path}`, { headers });
const signedIn = (path: string, token = "token-a") =>
  get(path, { Authorization: `Bearer ${token}` });

describe("classifyRequest", () => {
  const url = (path: string) => new URL(`https://suite.test${path}`);

  it("sorts the suite's own reads by path", () => {
    expect(classifyRequest("GET", url("/api/v1/settings/state"))).toBe("coalesce");
    expect(classifyRequest("GET", url("/api/v1/me"))).toBe("coalesce");
    expect(classifyRequest("GET", url("/api/v1/jmap/session"))).toBe("coalesce");
    expect(classifyRequest("GET", url("/api/v1/rooms/abc/events"))).toBe("background");
    expect(classifyRequest("GET", url("/api/v1/jmap/events/*/state/0"))).toBe("background");
    expect(classifyRequest("GET", url("/api/v1/files/threads/changes"))).toBe("background");
    expect(classifyRequest("GET", url("/api/v1/notifications"))).toBe("background");
    expect(classifyRequest("GET", url("/api/v1/tasks/items"))).toBe("foreground");
  });

  it("leaves other origins' paths and the app shell alone", () => {
    expect(classifyRequest("GET", url("/assets/app.js"))).toBeNull();
    expect(classifyRequest("GET", url("/api/v10/me"))).toBeNull();
    expect(classifyRequest("GET", url("/dav/api/v1/me"))).toBeNull();
  });

  it("lets writes through unless the caller marks them", () => {
    expect(classifyRequest("POST", url("/api/v1/rooms/abc/events"))).toBe("write");
    expect(classifyRequest("PUT", url("/api/v1/tasks/items/1"))).toBe("write");
    expect(classifyRequest("POST", url("/api/v1/jmap"), "/api/v1", "bulk")).toBe("bulk");
    expect(classifyRequest("POST", url("/api/v1/jmap"), "/api/v1", " Background ")).toBe(
      "background",
    );
    expect(classifyRequest("POST", url("/api/v1/jmap"), "/api/v1", "urgent")).toBe("write");
  });

  it("answers only the classes it can delay", () => {
    expect(["coalesce", "background", "bulk"].every((k) => isGovernedClass(k as never))).toBe(true);
    expect(isGovernedClass("foreground")).toBe(false);
    expect(isGovernedClass("write")).toBe(false);
  });
});

describe("RequestGovernor coalescing", () => {
  it("sends one settings read for many callers within the reuse window", async () => {
    const { governor, sent, advance } = harness();
    const answers = await Promise.all(
      [1, 2, 3, 4].map(() => governor.handle(signedIn("/settings/state"), "coalesce")),
    );
    expect(sent).toEqual(["/api/v1/settings/state"]);
    // Every caller can read its own copy of the body.
    expect(await Promise.all(answers.map((answer) => answer.text()))).toEqual([
      "{}",
      "{}",
      "{}",
      "{}",
    ]);
    advance(16_000);
    await governor.handle(signedIn("/settings/state"), "coalesce");
    expect(sent).toHaveLength(2);
  });

  it("never shares an answer between two sessions in one browser", async () => {
    const { governor, sent } = harness();
    await governor.handle(signedIn("/me", "token-a"), "coalesce");
    await governor.handle(signedIn("/me", "token-b"), "coalesce");
    expect(sent).toHaveLength(2);
  });

  it("does not share a read that carries no Authorization header", async () => {
    const { governor, sent } = harness();
    await governor.handle(get("/me"), "coalesce");
    await governor.handle(get("/me"), "coalesce");
    expect(sent).toHaveLength(2);
  });

  it("does not answer a forced refresh from the shared answer", async () => {
    const { governor, sent } = harness();
    await governor.handle(signedIn("/me"), "coalesce");
    const forced = new Request("https://suite.test/api/v1/me", {
      headers: { Authorization: "Bearer token-a" },
      cache: "reload",
    });
    await governor.handle(forced, "coalesce");
    expect(sent).toHaveLength(2);
  });

  it("retries after an answer that is not ok instead of sharing it", async () => {
    const { governor, sent } = harness({ status: 500 });
    await governor.handle(signedIn("/me"), "coalesce");
    await governor.handle(signedIn("/me"), "coalesce");
    expect(sent).toHaveLength(2);
  });

  it("drops shared answers when a write goes by, so a read after it sees the change", async () => {
    const { governor, sent } = harness();
    await governor.handle(signedIn("/settings/state"), "coalesce");
    governor.observe("write");
    await governor.handle(signedIn("/settings/state"), "coalesce");
    expect(sent).toHaveLength(2);
  });

  it("is not failed by a first caller that gave up", async () => {
    const { governor } = harness();
    const controller = new AbortController();
    const first = new Request("https://suite.test/api/v1/me", {
      headers: { Authorization: "Bearer token-a" },
      signal: controller.signal,
    });
    const pending = governor.handle(first, "coalesce");
    const second = governor.handle(signedIn("/me"), "coalesce");
    controller.abort();
    await pending.catch(() => undefined);
    expect((await second).status).toBe(200);
  });
});

describe("RequestGovernor background budget", () => {
  it("holds background polls to the budget once the burst is spent", async () => {
    const { governor, sent, now } = harness();
    for (let index = 0; index < 13; index += 1) {
      await governor.handle(get("/rooms/a/events"), "background");
    }
    // Burst of 3, then one every 2 s at 30 per minute: 10 more take 20 s.
    expect(sent).toHaveLength(13);
    expect(now()).toBeGreaterThanOrEqual(19_000);
    expect(now()).toBeLessThanOrEqual(21_000);
  });

  it("lets a quiet spell refill the burst", async () => {
    const { governor, now, advance } = harness();
    for (let index = 0; index < 3; index += 1) await governor.handle(get("/changes"), "background");
    advance(60_000);
    const before = now();
    for (let index = 0; index < 3; index += 1) await governor.handle(get("/changes"), "background");
    expect(now()).toBe(before);
  });

  it("makes polls yield to foreground reads and writes without delaying those", async () => {
    const { governor, now } = harness();
    for (let index = 0; index < 3; index += 1) {
      governor.observe(index === 0 ? "write" : "foreground");
    }
    const before = now();
    await governor.handle(get("/tasks/items"), "foreground");
    expect(now()).toBe(before);
    await governor.handle(get("/rooms/a/events"), "background");
    expect(now() - before).toBeGreaterThan(0);
  });

  it("never makes one poll wait longer than the maximum", async () => {
    const { governor, now } = harness({ burst: 1 });
    for (let index = 0; index < 100; index += 1) governor.observe("foreground");
    const before = now();
    await governor.handle(get("/rooms/a/events"), "background");
    expect(now() - before).toBeLessThanOrEqual(30_000);
  });

  it("serves polls in the order they came", async () => {
    const { governor, sent } = harness({ burst: 1 });
    await Promise.all(
      ["/a/changes", "/b/changes", "/c/changes"].map((path) =>
        governor.handle(get(path), "background"),
      ),
    );
    expect(sent).toEqual(["/api/v1/a/changes", "/api/v1/b/changes", "/api/v1/c/changes"]);
  });
});

describe("RequestGovernor brake", () => {
  it("brakes background requests after a 503 and lets writes and reads through", async () => {
    const { governor, now } = harness({ status: 503 });
    await governor.handle(get("/rooms/a/events"), "background");
    const before = now();
    await governor.handle(get("/rooms/a/events"), "background");
    expect(now() - before).toBeGreaterThanOrEqual(2_000);
    const foregroundAt = now();
    await governor.handle(get("/tasks/items"), "foreground");
    await governor.handle(
      new Request("https://suite.test/api/v1/tasks/items", { method: "POST" }),
      "write",
    );
    expect(now()).toBe(foregroundAt);
  });

  it("doubles the wait while the server keeps refusing, up to a minute", async () => {
    const { governor, now } = harness({ status: 429, burst: 50 });
    const waits: number[] = [];
    for (let index = 0; index < 8; index += 1) {
      const before = now();
      await governor.handle(get("/rooms/a/events"), "background");
      waits.push(now() - before);
    }
    expect(waits.slice(1, 4)).toEqual([2_000, 4_000, 8_000]);
    expect(Math.max(...waits)).toBeLessThanOrEqual(30_000);
  });

  it("brakes after a network error too, and the error still reaches the caller", async () => {
    const { governor, now } = harness({ fail: true });
    await expect(governor.handle(get("/rooms/a/events"), "background")).rejects.toThrow();
    const before = now();
    await expect(governor.handle(get("/rooms/a/events"), "background")).rejects.toThrow();
    expect(now() - before).toBeGreaterThanOrEqual(2_000);
  });

  it("follows Retry-After but waits no longer than the poll maximum", async () => {
    const { governor, now } = harness({ status: 429, headers: { "Retry-After": "20" } });
    await governor.handle(get("/changes"), "background");
    const before = now();
    await governor.handle(get("/changes"), "background");
    expect(now() - before).toBeGreaterThanOrEqual(20_000);
  });

  it("caps a huge Retry-After at five minutes", async () => {
    const { governor, now } = harness({ status: 429, headers: { "Retry-After": "86400" } });
    await governor.handle(get("/changes"), "bulk");
    const before = now();
    await governor.handle(get("/changes"), "bulk");
    expect(now() - before).toBeLessThanOrEqual(5 * 60_000);
  });

  it("clears the brake after a good answer", async () => {
    const { governor, now } = harness();
    await governor.handle(get("/changes"), "background");
    const before = now();
    await governor.handle(get("/changes"), "background");
    expect(now()).toBe(before);
  });
});

describe("RequestGovernor bulk", () => {
  it("paces bulk downloads one every 3 s without a burst", async () => {
    const { governor, sent, now } = harness();
    for (let index = 0; index < 5; index += 1) {
      await governor.handle(get("/files/x"), "bulk");
    }
    expect(sent).toHaveLength(5);
    expect(now()).toBeGreaterThanOrEqual(12_000);
  });

  it("goes one at a time when several tabs ask at once", async () => {
    const { governor, now } = harness();
    await Promise.all([1, 2, 3].map(() => governor.handle(get("/files/x"), "bulk")));
    expect(now()).toBeGreaterThanOrEqual(6_000);
  });
});

describe("traffic budget header", () => {
  it("parses the numbers and clamps them", () => {
    expect(parseTrafficBudget("background=30; bulk=20; burst=10")).toEqual({
      background: 30,
      bulk: 20,
      burst: 10,
    });
    expect(parseTrafficBudget("background=99999; bulk=0; burst=1")).toEqual({
      background: 10_000,
      bulk: 0,
      burst: 1,
    });
  });

  it("ignores a missing, partial or malformed header", () => {
    expect(parseTrafficBudget(null)).toBeNull();
    expect(parseTrafficBudget("")).toBeNull();
    expect(parseTrafficBudget("background=x")).toBeNull();
    expect(parseTrafficBudget("background=30; bulk=20")).toBeNull();
    expect(parseTrafficBudget("background=-1; bulk=20; burst=10")).toBeNull();
    expect(parseTrafficBudget("background=1e3; bulk=20; burst=10")).toBeNull();
  });

  it("takes the server's budget from an answer, and 0 turns pacing off", async () => {
    const { governor, now } = harness({
      headers: { [TRAFFIC_BUDGET_HEADER]: "background=0; bulk=0; burst=0" },
    });
    // The first answer carries the header; from then on nothing waits.
    await governor.handle(get("/changes"), "background");
    for (let index = 0; index < 20; index += 1) {
      await governor.handle(get("/changes"), "background");
      await governor.handle(get("/files/x"), "bulk");
    }
    expect(now()).toBe(0);
  });

  it("keeps the strict numbers when the server says nothing", async () => {
    const { governor, now } = harness();
    for (let index = 0; index < 8; index += 1) await governor.handle(get("/changes"), "background");
    expect(now()).toBeGreaterThan(0);
  });

  it("applies a roomier budget the server announces", async () => {
    const { governor, now, advance } = harness({
      headers: { [TRAFFIC_BUDGET_HEADER]: "background=120; bulk=120; burst=30" },
    });
    await governor.handle(get("/changes"), "background");
    advance(60_000);
    const before = now();
    for (let index = 0; index < 30; index += 1)
      await governor.handle(get("/changes"), "background");
    expect(now()).toBe(before);
  });

  it("keeps a bucket of at least one token, so a burst of 0 cannot stall polls", async () => {
    const { governor, now } = harness({
      headers: { [TRAFFIC_BUDGET_HEADER]: "background=30; bulk=20; burst=0" },
    });
    await governor.handle(get("/changes"), "background");
    await governor.handle(get("/changes"), "background");
    expect(now()).toBeLessThanOrEqual(3_000);
  });

  it("does not take a budget from an answer that is not from this origin", async () => {
    let clock = 0;
    const governor = new RequestGovernor({
      backgroundPerMinute: 30,
      burst: 1,
      bulkPerMinute: 20,
      coalesceTtlMs: 15_000,
      maxWaitMs: 30_000,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
      fetch: async () => {
        const response = new Response("{}", {
          headers: { [TRAFFIC_BUDGET_HEADER]: "background=0; bulk=0; burst=0" },
        });
        Object.defineProperty(response, "type", { value: "cors" });
        return response;
      },
    });
    await governor.handle(get("/changes"), "background");
    await governor.handle(get("/changes"), "background");
    await governor.handle(get("/changes"), "background");
    expect(clock).toBeGreaterThan(0);
  });
});
