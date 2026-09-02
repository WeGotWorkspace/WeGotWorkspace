/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createMeetCallStore } from "@/meet-core/src/meet-call-store";
import { useMeetRoomState, type UseMeetRoomStateArgs } from "@/meet-core/src/use-meet-room-state";

function renderRoomState(initial: UseMeetRoomStateArgs) {
  return renderHook((args: UseMeetRoomStateArgs) => useMeetRoomState(args), {
    initialProps: initial,
  });
}

describe("useMeetRoomState display identity", () => {
  it("adopts the authenticated session name once the bootstrap resolves", () => {
    const callStore = createMeetCallStore();

    // Pre-bootstrap mount: placeholder data, identity not ready yet.
    const first = renderRoomState({
      defaultDisplayName: "Guest",
      sessionDisplayName: "Guest",
      identityReady: false,
      callStore,
    });
    expect(first.result.current.displayName).toBe("Guest");
    first.unmount();

    // Bootstrap success remounts the workspace with the real identity, but the
    // suite-level store survives — the refresh must overwrite the placeholder.
    const second = renderRoomState({
      defaultDisplayName: "Admin User",
      sessionDisplayName: "Admin User",
      identityReady: true,
      callStore,
    });
    expect(second.result.current.displayName).toBe("Admin User");
    expect(callStore.displayNameRef.current).toBe("Admin User");
    second.unmount();
  });

  it("keeps Guest for a guest session with no authenticated identity", () => {
    const callStore = createMeetCallStore();

    const { result } = renderRoomState({
      defaultDisplayName: "Guest",
      sessionDisplayName: "Guest",
      identityReady: true,
      callStore,
    });
    expect(result.current.displayName).toBe("Guest");
    expect(callStore.displayNameRef.current).toBe("Guest");
  });

  it("never overwrites a user-edited name with the session identity", () => {
    const callStore = createMeetCallStore();

    const first = renderRoomState({
      defaultDisplayName: "Guest",
      sessionDisplayName: "Guest",
      identityReady: false,
      callStore,
    });
    act(() => {
      first.result.current.setDisplayName("My Nickname");
    });
    first.unmount();

    const second = renderRoomState({
      defaultDisplayName: "Admin User",
      sessionDisplayName: "Admin User",
      identityReady: true,
      callStore,
    });
    expect(second.result.current.displayName).toBe("My Nickname");
  });

  it("does not refresh while identity is still loading", () => {
    const callStore = createMeetCallStore();

    const { rerender, result } = renderRoomState({
      defaultDisplayName: "Guest",
      sessionDisplayName: "Guest",
      identityReady: false,
      callStore,
    });
    expect(result.current.displayName).toBe("Guest");

    rerender({
      defaultDisplayName: "Admin User",
      sessionDisplayName: "Admin User",
      identityReady: true,
      callStore,
    });
    expect(result.current.displayName).toBe("Admin User");
  });
});
