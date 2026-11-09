import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHECK_NOW_THROTTLE_MS, CheckNowThrottle } from "./check-now-throttle";

describe("CheckNowThrottle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function throttle() {
    const sent: string[][] = [];
    const subject = new CheckNowThrottle({ send: (usernames) => sent.push(usernames) });
    return { subject, sent };
  }

  it("nudges a peer at once, then at most once per window with one trailing nudge", async () => {
    const { subject, sent } = throttle();
    subject.request(["Bob"]);
    subject.request(["bob"]);
    subject.request(["bob"]);
    expect(sent).toEqual([["bob"]]);

    await vi.advanceTimersByTimeAsync(CHECK_NOW_THROTTLE_MS - 1);
    expect(sent).toEqual([["bob"]]);
    await vi.advanceTimersByTimeAsync(1);
    // Three writes in one window: the first nudge and one for the last write.
    expect(sent).toEqual([["bob"], ["bob"]]);

    await vi.advanceTimersByTimeAsync(CHECK_NOW_THROTTLE_MS * 3);
    expect(sent).toHaveLength(2);
  });

  it("keeps a window per peer, so another peer is never held back", async () => {
    const { subject, sent } = throttle();
    subject.request(["bob"]);
    await vi.advanceTimersByTimeAsync(500);
    subject.request(["bob", "carol", " ", "carol"]);
    expect(sent).toEqual([["bob"], ["carol"]]);

    await vi.advanceTimersByTimeAsync(1_500);
    expect(sent).toEqual([["bob"], ["carol"], ["bob"]]);
  });

  it("sends again at once after a quiet window", async () => {
    const { subject, sent } = throttle();
    subject.request(["bob"]);
    await vi.advanceTimersByTimeAsync(CHECK_NOW_THROTTLE_MS);
    subject.request(["bob"]);
    expect(sent).toEqual([["bob"], ["bob"]]);
  });

  it("drops a pending nudge on dispose", async () => {
    const { subject, sent } = throttle();
    subject.request(["bob"]);
    subject.request(["bob"]);
    subject.dispose();
    await vi.advanceTimersByTimeAsync(CHECK_NOW_THROTTLE_MS * 2);
    expect(sent).toEqual([["bob"]]);
  });
});
