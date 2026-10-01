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

function renderChime(ids: readonly string[] = [], enabled = true) {
  return renderHook(
    ({ nextIds, nextEnabled }: { nextIds: readonly string[]; nextEnabled: boolean }) =>
      useMeetKnockChime(nextIds, nextEnabled),
    { initialProps: { nextIds: ids, nextEnabled: enabled } },
  );
}

describe("useMeetKnockChime", () => {
  beforeEach(() => {
    playMeetKnockSound.mockClear();
    primeMeetKnockSound.mockClear();
    toastApi.show.mockClear();
  });

  it("plays once for each new knocker id while this peer is in the call", () => {
    const { rerender } = renderChime([], true);

    expect(playMeetKnockSound).not.toHaveBeenCalled();

    rerender({ nextIds: ["a"], nextEnabled: true });
    expect(playMeetKnockSound).toHaveBeenCalledTimes(1);
    expect(toastApi.show).toHaveBeenCalledWith(meetLabels.someoneKnocking, { severity: "info" });

    rerender({ nextIds: ["a"], nextEnabled: true });
    expect(playMeetKnockSound).toHaveBeenCalledTimes(1);

    rerender({ nextIds: ["a", "b"], nextEnabled: true });
    expect(playMeetKnockSound).toHaveBeenCalledTimes(2);
  });

  it("chimes when one knocker is admitted in the same poll that another knocks", () => {
    const { rerender } = renderChime(["a"], true);
    rerender({ nextIds: ["b"], nextEnabled: true });
    expect(playMeetKnockSound).toHaveBeenCalledTimes(2);
  });

  it("stays quiet for the person who is knocking", () => {
    const { rerender } = renderChime([], false);
    rerender({ nextIds: ["self"], nextEnabled: false });
    expect(playMeetKnockSound).not.toHaveBeenCalled();
  });

  it("chimes again for the same knocker after leaving and rejoining", () => {
    const { rerender } = renderChime([], true);
    rerender({ nextIds: ["a"], nextEnabled: true });
    expect(playMeetKnockSound).toHaveBeenCalledTimes(1);

    rerender({ nextIds: [], nextEnabled: false });
    rerender({ nextIds: ["a"], nextEnabled: true });
    expect(playMeetKnockSound).toHaveBeenCalledTimes(2);
  });

  it("does not chime when a knocker is admitted", () => {
    const { rerender } = renderChime([], true);
    rerender({ nextIds: ["a"], nextEnabled: true });
    rerender({ nextIds: [], nextEnabled: true });
    expect(playMeetKnockSound).toHaveBeenCalledTimes(1);
  });

  it("does not replay a knocker who is still waiting", () => {
    const { rerender } = renderChime(["a"], true);
    rerender({ nextIds: ["a"], nextEnabled: true });
    expect(playMeetKnockSound).toHaveBeenCalledTimes(1);
  });

  it("unlocks the chime on the next pointer or key only while it can play", () => {
    const { rerender } = renderChime([], false);

    window.dispatchEvent(new Event("pointerdown"));
    window.dispatchEvent(new Event("keydown"));
    expect(primeMeetKnockSound).not.toHaveBeenCalled();

    rerender({ nextIds: [], nextEnabled: true });
    window.dispatchEvent(new Event("pointerdown"));
    window.dispatchEvent(new Event("keydown"));
    expect(primeMeetKnockSound).toHaveBeenCalledTimes(2);
  });
});
