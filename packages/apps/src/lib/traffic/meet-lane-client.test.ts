import { afterEach, describe, expect, it, vi } from "vitest";
import { signalMeetLane } from "./meet-lane-client";
import { WGW_MEET_LANE_MESSAGE } from "./request-governor";

function controller() {
  const postMessage = vi.fn();
  vi.stubGlobal("navigator", { serviceWorker: { controller: { postMessage } } });
  return postMessage;
}

afterEach(() => {
  signalMeetLane("left", 0);
  vi.unstubAllGlobals();
});

describe("signalMeetLane", () => {
  it("posts the signal to the controlling worker and throttles repeats", () => {
    const post = controller();
    signalMeetLane("negotiating", 10_000);
    signalMeetLane("negotiating", 10_500);
    signalMeetLane("negotiating", 12_001);
    expect(post).toHaveBeenCalledTimes(2);
    expect(post).toHaveBeenCalledWith({ type: WGW_MEET_LANE_MESSAGE, signal: "negotiating" });
  });

  it("always sends join and left", () => {
    const post = controller();
    signalMeetLane("join", 1);
    signalMeetLane("join", 2);
    signalMeetLane("left", 3);
    expect(post).toHaveBeenCalledTimes(3);
  });

  it("is a no-op without a controlling worker", () => {
    vi.stubGlobal("navigator", { serviceWorker: { controller: null } });
    expect(() => signalMeetLane("join")).not.toThrow();
  });
});
