import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMeetCallBroadcast,
  type MeetCallBroadcastMessage,
} from "@/meet-core/src/meet-call-broadcast";

type FakeChannel = {
  postMessage: ReturnType<typeof vi.fn<(message: unknown) => void>>;
  close: ReturnType<typeof vi.fn<() => void>>;
  onmessage: ((event: MessageEvent) => void) | null;
  receive: (message: MeetCallBroadcastMessage) => void;
};

function createFakeChannel(): FakeChannel {
  const channel: FakeChannel = {
    postMessage: vi.fn<(message: unknown) => void>(),
    close: vi.fn<() => void>(),
    onmessage: null,
    receive: (message) => {
      channel.onmessage?.({ data: message } as MessageEvent);
    },
  };
  return channel;
}

describe("createMeetCallBroadcast", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function setup() {
    const channel = createFakeChannel();
    const onRemoteActiveChange = vi.fn();
    const broadcast = createMeetCallBroadcast({
      onRemoteActiveChange,
      channelFactory: () => channel,
      tabId: "tab-self",
    });
    return { channel, onRemoteActiveChange, broadcast: broadcast! };
  }

  it("queries existing tabs on creation", () => {
    const { channel } = setup();
    expect(channel.postMessage).toHaveBeenCalledWith({ kind: "query", tabId: "tab-self" });
  });

  it("reports remote active on 'active' and clears on 'inactive'", () => {
    const { channel, onRemoteActiveChange } = setup();

    channel.receive({ kind: "active", tabId: "tab-other", roomCode: "abcd" });
    expect(onRemoteActiveChange).toHaveBeenLastCalledWith(true);

    channel.receive({ kind: "inactive", tabId: "tab-other" });
    expect(onRemoteActiveChange).toHaveBeenLastCalledWith(false);
  });

  it("ignores its own messages", () => {
    const { channel, onRemoteActiveChange } = setup();
    channel.receive({ kind: "active", tabId: "tab-self", roomCode: "abcd" });
    expect(onRemoteActiveChange).not.toHaveBeenCalled();
  });

  it("answers queries while locally active and posts inactive when the call ends", () => {
    const { channel, broadcast } = setup();

    broadcast.setLocalActive(true, "abcd");
    expect(channel.postMessage).toHaveBeenCalledWith({
      kind: "active",
      tabId: "tab-self",
      roomCode: "abcd",
    });

    channel.postMessage.mockClear();
    channel.receive({ kind: "query", tabId: "tab-other" });
    expect(channel.postMessage).toHaveBeenCalledWith({
      kind: "active",
      tabId: "tab-self",
      roomCode: "abcd",
    });

    channel.postMessage.mockClear();
    broadcast.setLocalActive(false, null);
    expect(channel.postMessage).toHaveBeenCalledWith({ kind: "inactive", tabId: "tab-self" });
  });

  it("does not repost when local state is unchanged", () => {
    const { channel, broadcast } = setup();
    broadcast.setLocalActive(true, "abcd");
    channel.postMessage.mockClear();
    broadcast.setLocalActive(true, "abcd");
    expect(channel.postMessage).not.toHaveBeenCalled();
  });

  it("expires stale remote entries after the TTL sweep", () => {
    const { channel, onRemoteActiveChange } = setup();

    channel.receive({ kind: "active", tabId: "tab-other", roomCode: "abcd" });
    expect(onRemoteActiveChange).toHaveBeenLastCalledWith(true);

    // No re-announce from the remote tab: entry expires after TTL (45s) + sweep tick.
    vi.advanceTimersByTime(60_000);
    expect(onRemoteActiveChange).toHaveBeenLastCalledWith(false);
  });

  it("re-announces the local call on the sweep interval", () => {
    const { channel, broadcast } = setup();
    broadcast.setLocalActive(true, "abcd");
    channel.postMessage.mockClear();

    vi.advanceTimersByTime(15_000);
    expect(channel.postMessage).toHaveBeenCalledWith({
      kind: "active",
      tabId: "tab-self",
      roomCode: "abcd",
    });
  });

  it("posts inactive and closes the channel on close", () => {
    const { channel, broadcast } = setup();
    broadcast.setLocalActive(true, "abcd");
    channel.postMessage.mockClear();

    broadcast.close();
    expect(channel.postMessage).toHaveBeenCalledWith({ kind: "inactive", tabId: "tab-self" });
    expect(channel.close).toHaveBeenCalled();
  });
});
