import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionMetricsReporter } from "@/lib/rtc/telemetry/session-metrics-reporter";

afterEach(() => {
  vi.useRealTimers();
});

describe("SessionMetricsReporter", () => {
  it("sends one allow-listed sample per minute and skips presence", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-04T12:00:00Z"));
    const posts: Array<Record<string, unknown>> = [];
    const reporter = new SessionMetricsReporter({
      channel: "meet",
      post: async (body) => {
        posts.push(body);
      },
      sessionKey: () => "abc",
      net: () => "symmetric",
      now: () => Date.now(),
      schedule: (fn, ms) => setTimeout(fn, ms),
      cancel: (id) => {
        clearTimeout(id);
      },
    });

    reporter.begin();
    reporter.notePollRtt(40);
    reporter.noteFailedPair();
    await vi.advanceTimersByTimeAsync(1);
    expect(posts).toHaveLength(1);
    expect(posts[0]).toEqual({
      channel: "meet",
      failedPairs: 1,
      iceRestarts: 0,
      httpFallback: false,
      pollRttMs: 40,
      net: "symmetric",
    });
    expect(posts[0]).not.toHaveProperty("room");

    reporter.notePollRtt(80);
    await vi.advanceTimersByTimeAsync(59_000);
    expect(posts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(posts).toHaveLength(2);
    expect(posts[1]?.pollRttMs).toBe(60);

    const presence = new SessionMetricsReporter({
      channel: "principal",
      post: async (body) => {
        posts.push(body);
      },
      sessionKey: () => null,
      net: () => undefined,
    });
    presence.begin();
    presence.notePollRtt(10);
    presence.flush();
    expect(posts).toHaveLength(2);
  });

  it("keeps relay as the winning candidate type and reports join time", async () => {
    const posts: Array<Record<string, unknown>> = [];
    let now = 1_000;
    const reporter = new SessionMetricsReporter({
      channel: "collab",
      post: async (body) => {
        posts.push(body);
      },
      sessionKey: () => null,
      net: () => "open",
      now: () => now,
      schedule: () => 1 as unknown as ReturnType<typeof setTimeout>,
      cancel: () => undefined,
    });
    reporter.begin();
    now = 1_820;
    await reporter.noteConnected(statsConnection("host"));
    await reporter.noteConnected(statsConnection("relay"));
    reporter.noteHttpFallback();
    reporter.flush();
    expect(posts.at(-1)).toMatchObject({
      channel: "collab",
      joinMs: 820,
      candidateType: "relay",
      httpFallback: true,
      net: "open",
    });
  });
});

function statsConnection(candidateType: string): RTCPeerConnection {
  const report = new Map<string, RTCStats>([
    ["local", { id: "local", type: "local-candidate", timestamp: 0, candidateType } as RTCStats],
    [
      "pair",
      {
        id: "pair",
        type: "candidate-pair",
        timestamp: 0,
        selected: true,
        state: "succeeded",
        localCandidateId: "local",
      } as RTCStats,
    ],
  ]);
  return { getStats: async () => report } as unknown as RTCPeerConnection;
}
