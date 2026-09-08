import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useMeetMeshSync } from "@/meet-core/src/use-meet-mesh-sync";
import type { ChatMessage, MeetChannel } from "@/meet-core/src/meet-types";
import { PresenceStoreValueProvider } from "@/presence-core/src/presence-provider";
import { createPresenceStore, type PresenceStore } from "@/presence-core/src/presence-store";
import type {
  PresenceEnvelope,
  PresenceMeshEvent,
  PresenceMeshSession,
} from "@/presence-core/src/presence-types";
import type { RtcPeerDescriptor } from "@/lib/rtc/types";

class FakeSession implements PresenceMeshSession {
  peers: RtcPeerDescriptor[] = [];

  broadcasts: PresenceEnvelope[] = [];

  sentTo: Array<{ peerId: string; envelope: PresenceEnvelope }> = [];

  private readonly listeners = new Set<(event: PresenceMeshEvent) => void>();

  async join(): Promise<{ peerId: string }> {
    return { peerId: "alice-abc123" };
  }

  async leave(): Promise<void> {}

  broadcast(envelope: PresenceEnvelope): void {
    this.broadcasts.push(envelope);
  }

  sendTo(peerId: string, envelope: PresenceEnvelope): void {
    this.sentTo.push({ peerId, envelope });
  }

  getRoomPeers(): RtcPeerDescriptor[] {
    return this.peers;
  }

  onEvent(listener: (event: PresenceMeshEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: PresenceMeshEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

async function onlineStore() {
  const session = new FakeSession();
  const store = createPresenceStore({
    createSession: () => session,
    joinMode: "eager",
    visibility: null,
  });
  store.start({ username: "alice", displayName: "Alice" });
  await act(async () => {
    await Promise.resolve();
  });
  session.peers = [{ id: "bob-aaa111", name: "Bob", user: "bob" }];
  session.emit({ type: "roster" });
  return { session, store };
}

function wrapperFor(store: PresenceStore | null) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <PresenceStoreValueProvider store={store}>{children}</PresenceStoreValueProvider>;
  };
}

const channels: MeetChannel[] = [
  { id: "chat-grp-eng", name: "eng", kind: "channel", scope: "group", groupSlug: "eng" },
];

const sampleMessage: ChatMessage = {
  id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
  channelId: "dm:bob",
  authorId: "alice",
  authorName: "Alice",
  body: "hello",
  createdAt: Date.now(),
  reactions: [],
  mentions: [],
  previews: [],
  parentId: null,
};

describe("useMeetMeshSync", () => {
  it("fans a DM message out to the peer only", async () => {
    const { session, store } = await onlineStore();
    const sendMessage = vi.fn().mockResolvedValue(sampleMessage);
    const { result } = renderHook(
      () =>
        useMeetMeshSync({
          operations: { sendMessage },
          username: "alice",
          selfUsername: "alice",
          channels,
          directory: [{ id: "bob", displayName: "Bob", principalType: "user" }],
        }),
      { wrapper: wrapperFor(store) },
    );

    await act(async () => {
      await result.current.operations?.sendMessage?.("dm:bob", "hello");
    });

    expect(session.broadcasts).toEqual([]);
    expect(session.sentTo).toHaveLength(1);
    expect(session.sentTo[0]?.peerId).toBe("bob-aaa111");
    expect(session.sentTo[0]?.envelope.kind).toBe("channel-message");
  });

  it("applies inbound call-active onto the remapped DM id", async () => {
    const { session, store } = await onlineStore();
    const { result } = renderHook(
      () =>
        useMeetMeshSync({
          username: "alice",
          selfUsername: "alice",
          channels,
        }),
      { wrapper: wrapperFor(store) },
    );

    act(() => {
      session.emit({
        type: "envelope",
        peerId: "bob-aaa111",
        envelope: { v: 1, kind: "call-active", channel: "dm:alice", active: true },
      });
    });

    expect(result.current.meshCallActive).toEqual({ "dm:bob": true });
    expect(result.current.meshCallParticipants).toEqual({ "dm:bob": ["bob"] });
    expect(result.current.meshCallAudioOnly).toEqual({});
  });

  it("adds a call-active sender to the channel set and removes only that sender on false", async () => {
    const { session, store } = await onlineStore();
    session.peers = [
      { id: "bob-aaa111", name: "Bob", user: "bob" },
      { id: "carol-bbb222", name: "Carol", user: "carol" },
    ];
    const { result } = renderHook(
      () =>
        useMeetMeshSync({
          username: "alice",
          selfUsername: "alice",
          channels,
        }),
      { wrapper: wrapperFor(store) },
    );

    act(() => {
      session.emit({
        type: "envelope",
        peerId: "bob-aaa111",
        envelope: { v: 1, kind: "call-active", channel: "chat-grp-eng", active: true },
      });
      session.emit({
        type: "envelope",
        peerId: "carol-bbb222",
        envelope: { v: 1, kind: "call-active", channel: "chat-grp-eng", active: true },
      });
    });

    expect(result.current.meshCallParticipants).toEqual({
      "chat-grp-eng": ["bob", "carol"],
    });
    expect(result.current.meshCallActive).toEqual({ "chat-grp-eng": true });

    act(() => {
      session.emit({
        type: "envelope",
        peerId: "bob-aaa111",
        envelope: { v: 1, kind: "call-active", channel: "chat-grp-eng", active: false },
      });
    });

    expect(result.current.meshCallParticipants).toEqual({
      "chat-grp-eng": ["carol"],
    });
    expect(result.current.meshCallActive).toEqual({ "chat-grp-eng": true });

    act(() => {
      session.emit({
        type: "envelope",
        peerId: "carol-bbb222",
        envelope: { v: 1, kind: "call-active", channel: "chat-grp-eng", active: false },
      });
    });

    expect(result.current.meshCallParticipants).toEqual({ "chat-grp-eng": [] });
    expect(result.current.meshCallActive).toEqual({});
  });

  it("records inbound audioOnly and clears it on a later video start", async () => {
    const { session, store } = await onlineStore();
    session.peers = [
      { id: "bob-aaa111", name: "Bob", user: "bob" },
      { id: "carol-bbb222", name: "Carol", user: "carol" },
    ];
    const { result } = renderHook(
      () =>
        useMeetMeshSync({
          username: "alice",
          selfUsername: "alice",
          channels,
        }),
      { wrapper: wrapperFor(store) },
    );

    act(() => {
      session.emit({
        type: "envelope",
        peerId: "bob-aaa111",
        envelope: {
          v: 1,
          kind: "call-active",
          channel: "chat-grp-eng",
          active: true,
          audioOnly: true,
        },
      });
    });

    expect(result.current.meshCallAudioOnly).toEqual({ "chat-grp-eng": true });
    expect(result.current.meshCallParticipants).toEqual({ "chat-grp-eng": ["bob"] });

    act(() => {
      session.emit({
        type: "envelope",
        peerId: "carol-bbb222",
        envelope: { v: 1, kind: "call-active", channel: "chat-grp-eng", active: true },
      });
    });

    expect(result.current.meshCallAudioOnly).toEqual({});
    expect(result.current.meshCallParticipants).toEqual({ "chat-grp-eng": ["bob", "carol"] });
  });

  it("drops audioOnly when the last participant leaves", async () => {
    const { session, store } = await onlineStore();
    const { result } = renderHook(
      () =>
        useMeetMeshSync({
          username: "alice",
          selfUsername: "alice",
          channels,
        }),
      { wrapper: wrapperFor(store) },
    );

    act(() => {
      session.emit({
        type: "envelope",
        peerId: "bob-aaa111",
        envelope: {
          v: 1,
          kind: "call-active",
          channel: "chat-grp-eng",
          active: true,
          audioOnly: true,
        },
      });
      session.emit({
        type: "envelope",
        peerId: "bob-aaa111",
        envelope: { v: 1, kind: "call-active", channel: "chat-grp-eng", active: false },
      });
    });

    expect(result.current.meshCallParticipants).toEqual({ "chat-grp-eng": [] });
    expect(result.current.meshCallAudioOnly).toEqual({});
  });

  it("marks the local channel audio-only when startCall sets video false", async () => {
    const { session, store } = await onlineStore();
    const startCall = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(
      () =>
        useMeetMeshSync({
          operations: { startCall },
          username: "alice",
          selfUsername: "alice",
          channels,
          directory: [{ id: "bob", displayName: "Bob", principalType: "user" }],
        }),
      { wrapper: wrapperFor(store) },
    );

    await act(async () => {
      await result.current.operations?.startCall?.("chat-grp-eng", { video: false });
    });

    expect(startCall).toHaveBeenCalledWith("chat-grp-eng", { video: false });
    expect(result.current.meshCallAudioOnly).toEqual({ "chat-grp-eng": true });
    expect(session.sentTo[0]?.envelope).toMatchObject({
      kind: "call-active",
      channel: "chat-grp-eng",
      active: true,
      audioOnly: true,
    });
  });

  it("replays audioOnly call-active when a later peer comes online", async () => {
    const { session, store } = await onlineStore();
    const startCall = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = renderHook(
      ({ live }: { live: string | null }) =>
        useMeetMeshSync({
          operations: { startCall },
          liveCallChannelId: live,
          username: "alice",
          selfUsername: "alice",
          channels,
          directory: [
            { id: "bob", displayName: "Bob", principalType: "user" },
            { id: "carol", displayName: "Carol", principalType: "user" },
          ],
        }),
      { wrapper: wrapperFor(store), initialProps: { live: null as string | null } },
    );

    await act(async () => {
      await result.current.operations?.startCall?.("chat-grp-eng", { video: false });
    });
    const afterStart = session.sentTo.length;

    rerender({ live: "chat-grp-eng" });
    expect(session.sentTo.length).toBeGreaterThan(afterStart);
    expect(session.sentTo.at(-1)?.envelope).toMatchObject({
      kind: "call-active",
      channel: "chat-grp-eng",
      active: true,
      audioOnly: true,
    });

    session.peers = [
      { id: "bob-aaa111", name: "Bob", user: "bob" },
      { id: "carol-bbb222", name: "Carol", user: "carol" },
    ];
    act(() => {
      session.emit({ type: "roster" });
    });

    expect(session.sentTo.some((row) => row.peerId === "carol-bbb222")).toBe(true);
    expect(session.sentTo.find((row) => row.peerId === "carol-bbb222")?.envelope).toMatchObject({
      kind: "call-active",
      channel: "chat-grp-eng",
      audioOnly: true,
    });
  });
});
