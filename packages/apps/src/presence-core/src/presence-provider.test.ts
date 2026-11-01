/**
 * @vitest-environment jsdom
 */
import { act, render, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchRtcSettings } from "@/lib/api/wgw/rtc";
import { PresenceProvider } from "@/presence-core/src/presence-provider";
import { createPresenceStore } from "@/presence-core/src/presence-store";
import { PRESENCE_BOOT_RETRY_DELAYS_MS } from "@/presence-core/src/presence-types";

vi.mock("@/lib/api/wgw/http", () => ({
  wgwApiBaseUrl: () => "/api/v1",
  wgwCurrentAccessToken: () => "member-token",
  wgwHasAuthenticatedSession: () => true,
  wgwIsGuestSession: () => false,
  wgwFetchPrincipal: vi.fn(async () => ({
    user: { username: "member", displayName: "Member" },
  })),
}));

const SERVER_SETTINGS = {
  stunUrls: "stun:example.test:3478",
  turnAvailable: true,
  forceRelay: false,
};

vi.mock("@/lib/api/wgw/rtc", () => ({
  fetchRtcSettings: vi.fn(async () => SERVER_SETTINGS),
}));

vi.mock("@/presence-core/src/presence-rtc-session", () => ({
  createPresenceRtcSession: vi.fn(() => ({})),
}));

vi.mock("@/presence-core/src/presence-store", () => ({
  createPresenceStore: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn(async () => undefined),
  })),
}));

const rtcSettings = vi.mocked(fetchRtcSettings);
const storeFactory = vi.mocked(createPresenceStore);

function renderProvider() {
  return render(createElement(PresenceProvider, null, createElement("div")));
}

function setBrowserOnline(online: boolean) {
  Object.defineProperty(window.navigator, "onLine", { configurable: true, value: online });
}

/** Lets pending promise callbacks (and an unhandled rejection) settle. */
async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  rtcSettings.mockImplementation(async () => SERVER_SETTINGS);
  setBrowserOnline(true);
});

describe("PresenceProvider", () => {
  it("fetches workspace ICE settings with the member bearer token", async () => {
    renderProvider();

    await waitFor(() => {
      expect(fetchRtcSettings).toHaveBeenCalledWith({
        url: "/api/v1/rooms/p_workspace/configuration",
        bearerToken: "member-token",
      });
    });
    await waitFor(() => {
      expect(storeFactory.mock.results[0]?.value.start).toHaveBeenCalledWith({
        username: "member",
        displayName: "Member",
      });
    });
  });

  describe("offline start (#1832)", () => {
    const unhandled: unknown[] = [];
    const recordUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };

    beforeEach(() => {
      unhandled.length = 0;
      process.on("unhandledRejection", recordUnhandled);
    });

    afterEach(() => {
      process.off("unhandledRejection", recordUnhandled);
    });

    it("does not leak the network error and starts presence on the online event", async () => {
      setBrowserOnline(false);
      rtcSettings.mockRejectedValueOnce(new TypeError("Failed to fetch"));

      const view = renderProvider();
      await flush();

      expect(rtcSettings).toHaveBeenCalledTimes(1);
      expect(storeFactory).not.toHaveBeenCalled();
      expect(unhandled).toEqual([]);

      setBrowserOnline(true);
      act(() => {
        window.dispatchEvent(new Event("online"));
      });

      await waitFor(() => {
        expect(storeFactory).toHaveBeenCalledTimes(1);
      });
      expect(rtcSettings).toHaveBeenCalledTimes(2);
      expect(storeFactory.mock.results[0]?.value.start).toHaveBeenCalledWith({
        username: "member",
        displayName: "Member",
      });
      expect(unhandled).toEqual([]);
      view.unmount();
    });

    it("waits for the online event instead of retrying while the browser is offline", async () => {
      vi.useFakeTimers();
      setBrowserOnline(false);
      rtcSettings.mockRejectedValue(new TypeError("Failed to fetch"));

      const view = renderProvider();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(120_000);
      });

      expect(rtcSettings).toHaveBeenCalledTimes(1);
      expect(storeFactory).not.toHaveBeenCalled();
      view.unmount();
    });

    it("retries on a bounded backoff while the browser reports online", async () => {
      vi.useFakeTimers();
      rtcSettings.mockRejectedValue(new TypeError("Failed to fetch"));

      const view = renderProvider();
      const total = PRESENCE_BOOT_RETRY_DELAYS_MS.reduce((sum, delay) => sum + delay, 0);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(total * 2);
      });

      expect(rtcSettings).toHaveBeenCalledTimes(1 + PRESENCE_BOOT_RETRY_DELAYS_MS.length);
      expect(storeFactory).not.toHaveBeenCalled();

      rtcSettings.mockImplementation(async () => SERVER_SETTINGS);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(PRESENCE_BOOT_RETRY_DELAYS_MS[0]);
      });
      expect(storeFactory).not.toHaveBeenCalled();
      expect(unhandled).toEqual([]);
      view.unmount();
    });

    it("stops retrying after unmount", async () => {
      vi.useFakeTimers();
      rtcSettings.mockRejectedValue(new TypeError("Failed to fetch"));

      const view = renderProvider();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      view.unmount();
      window.dispatchEvent(new Event("online"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(120_000);
      });

      expect(rtcSettings).toHaveBeenCalledTimes(1);
      expect(storeFactory).not.toHaveBeenCalled();
    });
  });
});
