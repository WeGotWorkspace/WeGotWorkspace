import { describe, expect, it, vi } from "vitest";
import { LinkSupervisor } from "@/lib/rtc/link/link-supervisor-runtime";

function createHarness() {
  const timers = new Map<unknown, { fn: () => void; ms: number }>();
  let nextHandle = 1;
  let now = 0;
  const dial = vi.fn();
  const sendHint = vi.fn();
  const log = vi.fn();
  const supervisor = new LinkSupervisor({
    now: () => now,
    setTimeout: (fn, ms) => {
      const handle = nextHandle++;
      timers.set(handle, { fn, ms });
      return handle;
    },
    clearTimeout: (handle) => {
      timers.delete(handle);
    },
    isInitiator: () => true,
    dial,
    sendHint,
    log,
  });
  return {
    supervisor,
    dial,
    sendHint,
    log,
    timers,
    fireDue(elapsedMs: number) {
      now += elapsedMs;
      for (const [handle, timer] of [...timers.entries()]) {
        timer.ms -= elapsedMs;
        if (timer.ms <= 0) {
          timers.delete(handle);
          timer.fn();
        }
      }
    },
  };
}

describe("LinkSupervisor runtime", () => {
  it("schedule replaces the previous timer for the same peer", () => {
    const harness = createHarness();
    harness.supervisor.roster(["p"]);
    harness.fireDue(10_000);
    expect(harness.timers.size).toBe(1);
    const first = [...harness.timers.keys()][0];
    harness.supervisor.networkChange();
    expect(harness.timers.size).toBe(1);
    const second = [...harness.timers.keys()][0];
    expect(second).not.toBe(first);
  });

  it("a timer fires the timer event and runs its effects", () => {
    const harness = createHarness();
    harness.supervisor.roster(["p"]);
    harness.fireDue(10_000);
    expect(harness.dial).toHaveBeenCalledWith("p");
    expect(harness.log).toHaveBeenCalledWith("link-dial", { remoteId: "p" });
  });

  it("dispose clears timers and ignores later events", () => {
    const harness = createHarness();
    harness.supervisor.roster(["p"]);
    harness.supervisor.dispose();
    expect(harness.timers.size).toBe(0);
    harness.supervisor.roster(["q"]);
    expect(harness.timers.size).toBe(0);
    expect(harness.dial).not.toHaveBeenCalled();
  });
});
