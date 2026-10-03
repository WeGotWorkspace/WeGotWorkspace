import { describe, expect, it, vi } from "vitest";
import { MeshSignalInbox, type MeshSignalInboxPorts } from "@/lib/rtc/session/mesh-signal-inbox";
import type { HttpSignalingPollResult } from "@/lib/rtc/signaling/http-client";

function createInbox(overrides: Partial<MeshSignalInboxPorts> = {}) {
  const ports = {
    handleOffer: vi.fn(async () => {}),
    handleAnswer: vi.fn(async () => {}),
    handleIce: vi.fn(async () => {}),
    handleBye: vi.fn(async () => {}),
    log: vi.fn(),
    ...overrides,
  } satisfies MeshSignalInboxPorts;

  return { ports, inbox: new MeshSignalInbox(ports) };
}

function poll(messages: HttpSignalingPollResult["messages"]): HttpSignalingPollResult {
  return { peers: [{ id: "host-1", name: "Host" }], messages };
}

describe("MeshSignalInbox", () => {
  it("starts at zero and acks over every message type", () => {
    const { inbox } = createInbox();
    expect(inbox.cursor()).toBe(0);

    inbox.ack([
      { id: 4, from: "host-1", type: "chat", payload: { text: "hello" } },
      { id: 7, from: "host-1", type: "offer", payload: {} },
    ]);

    expect(inbox.cursor()).toBe(7);
  });

  it("never moves the cursor backwards on an out-of-order response", () => {
    const { inbox } = createInbox();
    inbox.ack([{ id: 9, from: "host-1", type: "chat", payload: {} }]);
    inbox.ack([{ id: 2, from: "host-1", type: "chat", payload: {} }]);

    expect(inbox.cursor()).toBe(9);
  });

  it("ignores rows a delete-on-read server sent without an id", () => {
    const { inbox } = createInbox();
    inbox.ack([{ from: "host-1", type: "chat", payload: {} }]);

    expect(inbox.cursor()).toBe(0);
  });

  it("reset returns to the pre-join cursor", () => {
    const { inbox } = createInbox();
    inbox.ack([{ id: 3, from: "host-1", type: "bye", payload: null }]);
    inbox.reset();

    expect(inbox.cursor()).toBe(0);
  });

  it("dispatches signals in offer, answer, ice, bye order and skips chat", async () => {
    const order: string[] = [];
    const { inbox } = createInbox({
      handleOffer: vi.fn(async () => void order.push("offer")),
      handleAnswer: vi.fn(async () => void order.push("answer")),
      handleIce: vi.fn(async () => void order.push("ice")),
      handleBye: vi.fn(async () => void order.push("bye")),
    });

    await inbox.applySignals(
      poll([
        { id: 1, from: "host-1", type: "bye", payload: null },
        { id: 2, from: "host-1", type: "chat", payload: { text: "hello" } },
        { id: 3, from: "host-1", type: "ice", payload: { candidate: "candidate:1" } },
        { id: 4, from: "host-1", type: "offer", payload: {} },
        { id: 5, from: "host-1", type: "answer", payload: {} },
      ]),
    );

    expect(order).toEqual(["offer", "answer", "ice", "bye"]);
  });

  it("drops an offer the mesh refuses but still lets the row be acked", async () => {
    const { ports, inbox } = createInbox({ shouldAcceptOffer: () => false });

    const data = poll([{ id: 11, from: "host-1", type: "offer", payload: {} }]);
    await inbox.applySignals(data);
    inbox.ack(data.messages);

    expect(ports.handleOffer).not.toHaveBeenCalled();
    expect(ports.log).toHaveBeenCalledWith("offer-ignored", {
      from: "host-1",
      reason: "should-accept-false",
    });
    expect(inbox.cursor()).toBe(11);
  });

  it("keeps dispatching after one handler throws", async () => {
    const { ports, inbox } = createInbox({
      handleOffer: vi.fn(async () => {
        throw new Error("setRemoteDescription failed");
      }),
    });

    await inbox.applySignals(
      poll([
        { id: 1, from: "host-1", type: "offer", payload: {} },
        { id: 2, from: "host-1", type: "ice", payload: { candidate: "candidate:1" } },
      ]),
    );

    expect(ports.handleIce).toHaveBeenCalledTimes(1);
    expect(ports.log).toHaveBeenCalledWith(
      "signal-handle-failed",
      expect.objectContaining({ type: "offer", from: "host-1" }),
    );
  });

  it("names the offering peer from the roster, falling back to Peer", async () => {
    const { ports, inbox } = createInbox();

    await inbox.applySignals(poll([{ id: 1, from: "host-1", type: "offer", payload: {} }]));
    await inbox.applySignals(poll([{ id: 2, from: "ghost-9", type: "offer", payload: {} }]));

    expect(ports.handleOffer).toHaveBeenNthCalledWith(1, "host-1", "Host", {});
    expect(ports.handleOffer).toHaveBeenNthCalledWith(2, "ghost-9", "Peer", {});
  });
});
