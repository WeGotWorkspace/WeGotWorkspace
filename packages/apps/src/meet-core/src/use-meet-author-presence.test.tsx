import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useMeetAuthorPresence } from "@/meet-core/src/use-meet-author-presence";
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

  private readonly listeners = new Set<(event: PresenceMeshEvent) => void>();

  async join(): Promise<{ peerId: string }> {
    return { peerId: "alice-abc123" };
  }

  async leave(): Promise<void> {}

  broadcast(_envelope: PresenceEnvelope): void {}

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
  return { session, store };
}

function wrapperFor(store: PresenceStore | null) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <PresenceStoreValueProvider store={store}>{children}</PresenceStoreValueProvider>;
  };
}

describe("useMeetAuthorPresence", () => {
  it("maps the presence roster to username → online/away", async () => {
    const { session, store } = await onlineStore();
    const { result } = renderHook(() => useMeetAuthorPresence(), {
      wrapper: wrapperFor(store),
    });

    act(() => {
      session.peers = [
        { id: "bob-aaa111", name: "Bob", user: "bob" },
        { id: "carol-bbb222", name: "Carol", user: "carol" },
      ];
      session.emit({ type: "roster" });
    });

    expect(result.current).toEqual({ bob: "online", carol: "online" });
  });

  it("returns undefined without a presence store", () => {
    const { result } = renderHook(() => useMeetAuthorPresence(), {
      wrapper: wrapperFor(null),
    });
    expect(result.current).toBeUndefined();
  });
});
