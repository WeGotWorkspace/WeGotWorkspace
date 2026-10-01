/**
 * @vitest-environment jsdom
 */
import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MeetCallStoreContext } from "@/meet-core/src/meet-call-provider";
import { createMeetCallStore, type MeetCallStore } from "@/meet-core/src/meet-call-store";
import { MeetKnockChime } from "@/meet-core/src/meet-knock-chime";

const playMeetKnockSound = vi.hoisted(() => vi.fn());

vi.mock("@/meet-core/src/meet-chat-utils", () => ({
  playMeetKnockSound,
  primeMeetKnockSound: vi.fn(),
}));

vi.mock("@/hooks/use-app-toast", () => ({
  useAppToast: () => ({
    show: vi.fn(),
    showSuccess: vi.fn(),
    showError: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

function renderChime(store: MeetCallStore) {
  return render(
    <MeetCallStoreContext.Provider value={store}>
      <MeetKnockChime />
    </MeetCallStoreContext.Provider>,
  );
}

describe("MeetKnockChime", () => {
  beforeEach(() => {
    playMeetKnockSound.mockClear();
  });

  it("stays silent without a suite call store", () => {
    render(<MeetKnockChime />);
    expect(playMeetKnockSound).not.toHaveBeenCalled();
  });

  it("stays silent for a guest who cannot admit", () => {
    const store = createMeetCallStore();
    store.setStatus("in-call");
    store.setCanModerateKnocks(false);
    renderChime(store);
    act(() => {
      store.setKnockers([{ id: "a", name: "Ada" }]);
    });
    expect(playMeetKnockSound).not.toHaveBeenCalled();
  });

  it("chimes once for a new knocker and not again while that knocker is still waiting", () => {
    const store = createMeetCallStore();
    store.setStatus("in-call");
    store.setCanModerateKnocks(true);
    renderChime(store);

    act(() => {
      store.setKnockers([{ id: "a", name: "Ada" }]);
      store.setElapsedSeconds(1);
    });
    expect(playMeetKnockSound).toHaveBeenCalledTimes(1);
  });
});
