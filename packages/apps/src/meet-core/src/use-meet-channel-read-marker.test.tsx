import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMeetChannelReadMarker } from "@/meet-core/src/use-meet-channel-read-marker";

function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
}

describe("useMeetChannelReadMarker", () => {
  afterEach(() => {
    setVisibility("visible");
  });

  it("marks the selected channel on select", () => {
    const markChannelRead = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderHook(
      (props: { selectedChannelId: string | null }) =>
        useMeetChannelReadMarker({
          selectedChannelId: props.selectedChannelId,
          markChannelRead,
        }),
      { initialProps: { selectedChannelId: null as string | null } },
    );

    expect(markChannelRead).not.toHaveBeenCalled();

    rerender({ selectedChannelId: "chat-general" });
    expect(markChannelRead).toHaveBeenCalledWith("chat-general");
  });

  it("marks again when a new message arrives on the visible selected channel", () => {
    const markChannelRead = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderHook(
      (props: { selectedLatestMessageId: string | null }) =>
        useMeetChannelReadMarker({
          selectedChannelId: "chat-general",
          markChannelRead,
          selectedLatestMessageId: props.selectedLatestMessageId,
        }),
      { initialProps: { selectedLatestMessageId: "msg-1" as string | null } },
    );

    markChannelRead.mockClear();
    rerender({ selectedLatestMessageId: "msg-2" });
    expect(markChannelRead).toHaveBeenCalledWith("chat-general");
  });

  it("does not mark inbound while the tab is hidden, then marks on resume", () => {
    const markChannelRead = vi.fn().mockResolvedValue(undefined);
    setVisibility("hidden");
    const { rerender } = renderHook(
      (props: { selectedLatestMessageId: string | null }) =>
        useMeetChannelReadMarker({
          selectedChannelId: "chat-general",
          markChannelRead,
          selectedLatestMessageId: props.selectedLatestMessageId,
        }),
      { initialProps: { selectedLatestMessageId: "msg-1" as string | null } },
    );

    markChannelRead.mockClear();
    rerender({ selectedLatestMessageId: "msg-2" });
    expect(markChannelRead).not.toHaveBeenCalled();

    setVisibility("visible");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(markChannelRead).toHaveBeenCalledWith("chat-general");
  });
});
