import { describe, expect, it, vi } from "vitest";
import { icePayloadCandidates, IceOutbound } from "@/lib/rtc/session/ice-batch";

const one = { candidate: "candidate:1 1 udp 1 1.1.1.1 9 typ host", sdpMid: "0" };
const two = { candidate: "candidate:2 1 udp 1 1.1.1.1 9 typ host", sdpMid: "0" };

describe("icePayloadCandidates", () => {
  it("accepts one candidate, a batch object, and a bare array", () => {
    expect(icePayloadCandidates(one)).toEqual([one]);
    expect(icePayloadCandidates({ candidates: [one, two] })).toEqual([one, two]);
    expect(icePayloadCandidates([one, two])).toEqual([one, two]);
    expect(icePayloadCandidates({ candidate: "  " })).toEqual([]);
  });
});

describe("IceOutbound", () => {
  it("sends immediately when the peer did not advertise ice-batch", () => {
    const send = vi.fn();
    const outbound = new IceOutbound({ acceptsBatch: () => false, send });
    outbound.note("peer", one);
    expect(send).toHaveBeenCalledWith("peer", one);
  });

  it("flushes a batch after the window", () => {
    vi.useFakeTimers();
    const send = vi.fn();
    const outbound = new IceOutbound({ acceptsBatch: () => true, send, delayMs: 150 });
    outbound.note("peer", one);
    outbound.note("peer", two);
    expect(send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(150);
    expect(send).toHaveBeenCalledWith("peer", { candidates: [one, two] });
    vi.useRealTimers();
  });
});
