import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RtcPeerDescriptor } from "@/lib/rtc/types";
import { useMeetChannelTyping } from "@/meet-core/src/use-meet-channel-typing";
import { PresenceStoreValueProvider } from "@/presence-core/src/presence-provider";
import { createPresenceStore, type PresenceStore } from "@/presence-core/src/presence-store";
import type {
  PresenceEnvelope,
  PresenceMeshEvent,
  PresenceMeshSession,
} from "@/presence-core/src/presence-types";

class FakeSession implements PresenceMeshSession {
  peers: RtcPeerDescriptor[] = [];

  broadcasts: PresenceEnvelope[] = [];

  private readonly listeners = new Set<(event: PresenceMeshEvent) => void>();

  async join(): Promise<{ peerId: string }> {
    return { peerId: "alice-abc123" };
  }

  async leave(): Promise<void> {}

  broadcast(envelope: PresenceEnvelope): void {
    this.broadcasts.push(envelope);
  }

  sendTo(): void {}

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

async function onlineStore(nowRef: { value: number }) {
  const session = new FakeSession();
  const store = createPresenceStore({
    createSession: () => session,
    joinMode: "eager",
    visibility: null,
    now: () => nowRef.value,
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

afterEach(() => {
  vi.useRealTimers();
});

describe("useMeetChannelTyping", () => {
  it("surfaces inbound channel typing and drops it on stop", async () => {
    const nowRef = { value: 1000 };
    const { session, store } = await onlineStore(nowRef);
    const { result } = renderHook(() => useMeetChannelTyping(), {
      wrapper: wrapperFor(store),
    });

    act(() => {
      session.emit({
        type: "envelope",
        peerId: "bob-aaa111",
        envelope: { v: 1, kind: "typing", channel: "channel-general" },
      });
    });
    expect(result.current.typingByChannel).toEqual({ "channel-general": ["bob"] });

    act(() => {
      session.emit({
        type: "envelope",
        peerId: "bob-aaa111",
        envelope: { v: 1, kind: "typing", channel: "channel-general", stop: true },
      });
    });
    expect(result.current.typingByChannel).toEqual({});
  });

  it("throttles composer activity into heartbeat broadcasts and retracts on stop", async () => {
    const nowRef = { value: 1000 };
    const { session, store } = await onlineStore(nowRef);
    const { result } = renderHook(() => useMeetChannelTyping(), {
      wrapper: wrapperFor(store),
    });

    act(() => {
      result.current.onComposerTyping("channel-general", true);
      result.current.onComposerTyping("channel-general", true); // throttled
    });
    expect(session.broadcasts).toEqual([{ v: 1, kind: "typing", channel: "channel-general" }]);

    act(() => {
      result.current.onComposerTyping("channel-general", false);
    });
    expect(session.broadcasts).toEqual([
      { v: 1, kind: "typing", channel: "channel-general" },
      { v: 1, kind: "typing", channel: "channel-general", stop: true },
    ]);
  });

  it("retracts the active typing signal on unmount", async () => {
    const nowRef = { value: 1000 };
    const { session, store } = await onlineStore(nowRef);
    const { result, unmount } = renderHook(() => useMeetChannelTyping(), {
      wrapper: wrapperFor(store),
    });

    act(() => {
      result.current.onComposerTyping("channel-general", true);
    });
    unmount();

    expect(session.broadcasts).toEqual([
      { v: 1, kind: "typing", channel: "channel-general" },
      { v: 1, kind: "typing", channel: "channel-general", stop: true },
    ]);
  });

  it("degrades silently without a presence store", () => {
    const { result } = renderHook(() => useMeetChannelTyping(), {
      wrapper: wrapperFor(null),
    });

    expect(result.current.typingByChannel).toEqual({});
    expect(() => {
      result.current.onComposerTyping("channel-general", true);
      result.current.onComposerTyping("channel-general", false);
    }).not.toThrow();
  });
});
