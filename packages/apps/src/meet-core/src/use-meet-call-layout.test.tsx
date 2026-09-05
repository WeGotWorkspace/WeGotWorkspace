import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useMeetCallLayout } from "@/meet-core/src/use-meet-call-layout";

describe("useMeetCallLayout", () => {
  it("joins into the compact bar, not the split stage", () => {
    const startCall = vi.fn(async () => undefined);
    const { result } = renderHook(() =>
      useMeetCallLayout({
        initialLayout: "collapsed",
        channelId: "channel-general",
        operations: { startCall, leaveCall: vi.fn(async () => undefined) },
      }),
    );

    act(() => {
      result.current.toggleCall();
    });

    expect(result.current.callActive).toBe(true);
    expect(result.current.callLayout).toBe("compact");
    expect(startCall).toHaveBeenCalledWith("channel-general");
  });

  it("returns to the compact bar when the expanded stage is dismissed", () => {
    const { result } = renderHook(() =>
      useMeetCallLayout({
        initialLayout: "side-by-side",
        channelId: "channel-general",
      }),
    );

    act(() => {
      result.current.onLayoutChange("compact");
    });

    expect(result.current.callActive).toBe(true);
    expect(result.current.callLayout).toBe("compact");
  });

  it("leaves the call when layout collapses", () => {
    const leaveCall = vi.fn(async () => undefined);
    const { result } = renderHook(() =>
      useMeetCallLayout({
        initialLayout: "compact",
        channelId: "channel-general",
        operations: { startCall: vi.fn(async () => undefined), leaveCall },
      }),
    );

    act(() => {
      result.current.toggleCall();
    });

    expect(result.current.callActive).toBe(false);
    expect(result.current.callLayout).toBe("collapsed");
    expect(leaveCall).toHaveBeenCalledWith("channel-general");
  });

  it("keeps the in-call session on its channel when the selected channel changes", () => {
    const leaveCall = vi.fn(async () => undefined);
    const { result, rerender } = renderHook(
      ({ channelId }: { channelId: string }) =>
        useMeetCallLayout({
          initialLayout: "collapsed",
          channelId,
          operations: { startCall: vi.fn(async () => undefined), leaveCall },
        }),
      { initialProps: { channelId: "channel-general" } },
    );

    act(() => {
      result.current.toggleCall();
    });
    expect(result.current.callLayout).toBe("compact");

    rerender({ channelId: "channel-random" });
    expect(result.current.callActive).toBe(false);
    expect(result.current.callLayout).toBe("collapsed");
    expect(result.current.isChannelJoined("channel-general")).toBe(true);
    expect(result.current.isChannelJoined("channel-random")).toBe(false);
    expect(leaveCall).not.toHaveBeenCalled();

    rerender({ channelId: "channel-general" });
    expect(result.current.callActive).toBe(true);
    expect(result.current.callLayout).toBe("compact");
  });

  it("collapses the chrome when the start operation rejects", async () => {
    let rejectStart: (error: Error) => void = () => {};
    const startCall = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectStart = reject;
        }),
    );
    const { result } = renderHook(() =>
      useMeetCallLayout({
        initialLayout: "collapsed",
        channelId: "channel-general",
        operations: { startCall },
      }),
    );

    act(() => {
      result.current.startCall();
    });
    expect(result.current.callLayout).toBe("compact");

    await act(async () => {
      rejectStart(new Error("calls unavailable"));
      await Promise.resolve();
    });
    expect(result.current.callActive).toBe(false);
    expect(result.current.callLayout).toBe("collapsed");
  });

  it("restores the stage for an already-running live session (route remount)", () => {
    const { result } = renderHook(() =>
      useMeetCallLayout({
        initialLayout: "collapsed",
        channelId: "channel-general",
        liveCallChannelId: "channel-general",
      }),
    );

    expect(result.current.callActive).toBe(true);
    expect(result.current.callLayout).toBe("side-by-side");
  });

  it("collapses the channel when its live session ends remotely", () => {
    const { result, rerender } = renderHook(
      ({ live }: { live: string | null }) =>
        useMeetCallLayout({
          initialLayout: "collapsed",
          channelId: "channel-general",
          liveCallChannelId: live,
        }),
      { initialProps: { live: null as string | null } },
    );

    act(() => {
      result.current.startCall();
    });
    expect(result.current.callLayout).toBe("compact");

    rerender({ live: "channel-general" });
    // The user's chosen layout is respected while the session is live.
    expect(result.current.callLayout).toBe("compact");

    rerender({ live: null });
    expect(result.current.callActive).toBe(false);
    expect(result.current.callLayout).toBe("collapsed");
  });

  it("does not re-open the stage after a local leave while the session winds down", () => {
    const { result, rerender } = renderHook(
      ({ live }: { live: string | null }) =>
        useMeetCallLayout({
          initialLayout: "compact",
          channelId: "channel-general",
          liveCallChannelId: live,
        }),
      { initialProps: { live: null as string | null } },
    );

    rerender({ live: "channel-general" });
    act(() => {
      // Local leave: layout collapses immediately; the async session teardown
      // has not flipped liveCallChannelId to null yet.
      result.current.leaveCall();
    });
    expect(result.current.callLayout).toBe("collapsed");

    rerender({ live: null });
    expect(result.current.callLayout).toBe("collapsed");
  });

  it("seeds initialLayout for the starting channel only", () => {
    const { result, rerender } = renderHook(
      ({ channelId }: { channelId: string }) =>
        useMeetCallLayout({
          initialLayout: "fullscreen",
          channelId,
        }),
      { initialProps: { channelId: "channel-design" } },
    );

    expect(result.current.callLayout).toBe("fullscreen");
    rerender({ channelId: "channel-general" });
    expect(result.current.callLayout).toBe("collapsed");
    rerender({ channelId: "channel-design" });
    expect(result.current.callLayout).toBe("fullscreen");
  });
});
