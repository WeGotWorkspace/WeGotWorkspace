import { describe, expect, it } from "vitest";
import type { WgwChatChannel } from "@/lib/api/wgw/meet-chat";
import type { ChatMessage } from "@/meet-core/src/meet-types";
import {
  buildUiChannelIdMap,
  dmUnreadFromWireChannels,
  uiChannelIdForWire,
  uiChatMessageFromMap,
  uiDmChannelIdForWire,
} from "@/lib/offline/meet-chat/meet-chat-dm";

const rights = {
  mayReadItems: true,
  mayWriteAll: true,
  mayWriteOwn: true,
  mayUpdatePrivate: true,
  mayRSVP: true,
  mayAdmin: false,
  mayDelete: true,
  mayShare: false,
};

function wireChannel(overrides: Partial<WgwChatChannel>): WgwChatChannel {
  return {
    id: "chat-general",
    name: "General",
    kind: "channel",
    scope: "personal",
    groupSlug: null,
    isSharee: false,
    myRights: rights,
    ...overrides,
  } as WgwChatChannel;
}

const dmWithBob = wireChannel({
  id: "dm-0123456789abcdef0123456789abcdef01234567",
  name: "Bob",
  kind: "dm",
  dmPeer: "bob",
  unreadCount: 3,
});

describe("meet-chat-dm", () => {
  it("maps dm wire rows onto virtual dm:{peer} ids and leaves channels alone", () => {
    expect(uiDmChannelIdForWire(dmWithBob)).toBe("dm:bob");
    expect(uiDmChannelIdForWire(wireChannel({}))).toBeNull();
    // A dm row without a peer (should not happen) never mints a broken id.
    expect(uiDmChannelIdForWire(wireChannel({ kind: "dm", dmPeer: null }))).toBeNull();

    expect(uiChannelIdForWire(dmWithBob)).toBe("dm:bob");
    expect(uiChannelIdForWire(wireChannel({}))).toBe("chat-general");
  });

  it("re-keys messages of dm channels through the id map", () => {
    const map = buildUiChannelIdMap([wireChannel({}), dmWithBob]);
    expect(map.get(dmWithBob.id)).toBe("dm:bob");
    expect(map.has("chat-general")).toBe(false);

    const message = { id: "m1", channelId: dmWithBob.id } as ChatMessage;
    expect(uiChatMessageFromMap(message, map).channelId).toBe("dm:bob");
    const channelMessage = { id: "m2", channelId: "chat-general" } as ChatMessage;
    expect(uiChatMessageFromMap(channelMessage, map)).toBe(channelMessage);
  });

  it("collects dm unread badges keyed by peer, dropping zero counts", () => {
    const read = wireChannel({ id: "dm-b", kind: "dm", dmPeer: "carol", unreadCount: 0 });
    expect(dmUnreadFromWireChannels([dmWithBob, read, wireChannel({})])).toEqual({ bob: 3 });
  });
});
