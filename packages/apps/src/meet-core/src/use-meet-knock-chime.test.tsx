/**
 * @vitest-environment jsdom
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { meetLabels } from "@/meet-core/src/meet-labels";
import { useMeetKnockChime } from "@/meet-core/src/use-meet-knock-chime";

const playMeetKnockSound = vi.hoisted(() => vi.fn());
const primeMeetKnockSound = vi.hoisted(() => vi.fn());

vi.mock("@/meet-core/src/meet-chat-utils", () => ({
  playMeetKnockSound,
  primeMeetKnockSound,
}));

const toastApi = {
  show: vi.fn(),
  showSuccess: vi.fn(),
  showError: vi.fn(),
  dismiss: vi.fn(),
};

vi.mock("@/hooks/use-app-toast", () => ({
  useAppToast: () => toastApi,
}));

describe("useMeetKnockChime", () => {
  beforeEach(() => {
    playMeetKnockSound.mockClear();
    primeMeetKnockSound.mockClear();
    toastApi.show.mockClear();
  });

  it("plays once each time another person knocks while this peer is in the call", () => {
    const { rerender } = renderHook(
      ({ count, inCall }: { count: number; inCall: boolean }) => useMeetKnockChime(count, inCall),
      { initialProps: { count: 0, inCall: true } },
    );

    expect(playMeetKnockSound).not.toHaveBeenCalled();

    rerender({ count: 1, inCall: true });
    expect(playMeetKnockSound).toHaveBeenCalledTimes(1);
    expect(toastApi.show).toHaveBeenCalledWith(meetLabels.someoneKnocking, { severity: "info" });

    rerender({ count: 1, inCall: true });
    expect(playMeetKnockSound).toHaveBeenCalledTimes(1);

    rerender({ count: 2, inCall: true });
    expect(playMeetKnockSound).toHaveBeenCalledTimes(2);
  });

  it("stays quiet for the person who is knocking, then chimes once they are in the call and someone is still waiting", () => {
    const { rerender } = renderHook(
      ({ count, inCall }: { count: number; inCall: boolean }) => useMeetKnockChime(count, inCall),
      { initialProps: { count: 0, inCall: false } },
    );

    rerender({ count: 1, inCall: false });
    expect(playMeetKnockSound).not.toHaveBeenCalled();

    rerender({ count: 1, inCall: true });
    expect(playMeetKnockSound).toHaveBeenCalledTimes(1);
  });

  it("does not chime when a knocker is admitted", () => {
    const { rerender } = renderHook(
      ({ count, inCall }: { count: number; inCall: boolean }) => useMeetKnockChime(count, inCall),
      { initialProps: { count: 0, inCall: true } },
    );

    rerender({ count: 1, inCall: true });
    rerender({ count: 0, inCall: true });
    expect(playMeetKnockSound).toHaveBeenCalledTimes(1);
  });

  it("unlocks the chime on the next pointer or key so a later knock can play", () => {
    renderHook(() => useMeetKnockChime(0, true));

    window.dispatchEvent(new Event("pointerdown"));
    window.dispatchEvent(new Event("keydown"));
    expect(primeMeetKnockSound).toHaveBeenCalledTimes(2);
  });
});
