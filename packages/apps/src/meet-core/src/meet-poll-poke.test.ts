import { describe, expect, it, vi } from "vitest";
import { meetDcChatFrame, meetDcPokeFrame } from "@/lib/rtc/session/meet-data-channel";
import { createMeetPokeGate, handleMeetDataFrame } from "@/meet-core/src/meet-poll-poke";

const CLIENT_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

describe("createMeetPokeGate", () => {
  it("allows at most one poke per second on an injected clock", () => {
    let now = 1_000;
    const gate = createMeetPokeGate(() => now);

    expect(gate.allow()).toBe(true);
    now = 1_999;
    expect(gate.allow()).toBe(false);
    now = 2_000;
    expect(gate.allow()).toBe(true);
  });
});

describe("handleMeetDataFrame", () => {
  it("kicks on a poke and never forwards it as chat", () => {
    const onKick = vi.fn();
    const onChat = vi.fn();
    handleMeetDataFrame({
      raw: JSON.stringify(meetDcPokeFrame()),
      gate: createMeetPokeGate(() => 1_000),
      onKick,
      onChat,
    });
    expect(onKick).toHaveBeenCalledTimes(1);
    expect(onChat).not.toHaveBeenCalled();
  });

  it("suppresses a second poke inside the gate window", () => {
    let now = 1_000;
    const gate = createMeetPokeGate(() => now);
    const onKick = vi.fn();
    const onChat = vi.fn();
    const args = {
      raw: JSON.stringify(meetDcPokeFrame()),
      gate,
      onKick,
      onChat,
    };

    handleMeetDataFrame(args);
    now = 1_500;
    handleMeetDataFrame(args);

    expect(onKick).toHaveBeenCalledTimes(1);
    expect(onChat).not.toHaveBeenCalled();
  });

  it("forwards non-poke frames to onChat", () => {
    const onKick = vi.fn();
    const onChat = vi.fn();
    const raw = JSON.stringify(meetDcChatFrame({ id: CLIENT_ID, text: "hello", ts: 10 }));
    handleMeetDataFrame({
      raw,
      gate: createMeetPokeGate(() => 1_000),
      onKick,
      onChat,
    });
    expect(onKick).not.toHaveBeenCalled();
    expect(onChat).toHaveBeenCalledTimes(1);
    expect(onChat).toHaveBeenCalledWith(raw);
  });
});
