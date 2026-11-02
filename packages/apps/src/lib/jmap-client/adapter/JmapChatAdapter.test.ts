import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JmapClient } from "../core/JmapClient.js";
import { JmapChatAdapter } from "./JmapChatAdapter";

const channelChanges = vi.fn();
const messageChanges = vi.fn();
const getChannels = vi.fn();
const getMessages = vi.fn();

vi.mock("../chat/JmapChatClient.js", () => ({
  JmapChatClient: class {
    channelChanges = channelChanges;
    messageChanges = messageChanges;
    getChannels = getChannels;
    getMessages = getMessages;
  },
}));

function clientStub(states: Record<string, string>): JmapClient {
  return {
    isConnected: true,
    primaryAccountId: () => "bob",
    getState: (_account: string, type: string) => states[type],
  } as unknown as JmapClient;
}

const none = (newState: string) => ({
  created: [],
  updated: [],
  destroyed: [],
  newState,
  hasMoreChanges: false,
});

describe("JmapChatAdapter.syncIfStale", () => {
  beforeEach(() => {
    for (const mock of [channelChanges, messageChanges, getChannels, getMessages]) mock.mockReset();
  });

  it("skips /changes when the pushed states equal its own", async () => {
    const adapter = new JmapChatAdapter({
      client: clientStub({ ChatChannel: "c1", ChatMessage: "m1" }),
    });
    await expect(adapter.syncIfStale({ ChatChannel: "c1", ChatMessage: "m1" })).resolves.toBe(true);
    expect(channelChanges).not.toHaveBeenCalled();
    expect(messageChanges).not.toHaveBeenCalled();
  });

  it("syncs and forwards new messages when a pushed state differs", async () => {
    const onRemoteMessage = vi.fn();
    const adapter = new JmapChatAdapter({
      client: clientStub({ ChatChannel: "c1", ChatMessage: "m1" }),
      onRemoteMessage,
    });
    channelChanges.mockResolvedValue(none("c1"));
    messageChanges.mockResolvedValue({ ...none("m2"), created: ["msg-1"] });
    getMessages.mockResolvedValue({ list: [{ id: "msg-1" }] });
    await expect(adapter.syncIfStale({ ChatMessage: "m2" }, "bob")).resolves.toBe(true);
    expect(onRemoteMessage).toHaveBeenCalledWith({ id: "msg-1" });
  });
});
