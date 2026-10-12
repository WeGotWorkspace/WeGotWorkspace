/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api/wgw/http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/wgw/http")>();
  return {
    ...actual,
    wgwEnsureFreshAccessToken: vi.fn(),
    wgwFetchPrincipal: vi.fn(),
  };
});

vi.mock("@/lib/api/wgw/rtc", () => ({
  fetchRtcSettings: vi.fn(),
}));

import { wgwEnsureFreshAccessToken, wgwFetchPrincipal } from "@/lib/api/wgw/http";
import { fetchRtcSettings } from "@/lib/api/wgw/rtc";
import { fetchMeetLiveBootstrap } from "@/lib/api/wgw/meet";

const ensureToken = vi.mocked(wgwEnsureFreshAccessToken);
const fetchPrincipal = vi.mocked(wgwFetchPrincipal);
const rtcSettings = vi.mocked(fetchRtcSettings);

describe("fetchMeetLiveBootstrap", () => {
  beforeEach(() => {
    ensureToken.mockReset().mockResolvedValue("fresh-token");
    fetchPrincipal.mockReset().mockResolvedValue({
      user: {
        displayName: "Bob",
        initials: "B",
        username: "bob",
      },
      viewerInboxLabel: "me",
    });
    rtcSettings.mockReset().mockResolvedValue({
      stunUrls: "stun:example.test",
      turnAvailable: true,
      forceRelay: false,
      source: "server",
    });
  });

  it("fetches RTC settings with a fresh bearer token", async () => {
    const bootstrap = await fetchMeetLiveBootstrap();

    expect(ensureToken).toHaveBeenCalledOnce();
    expect(rtcSettings).toHaveBeenCalledWith({
      bearerToken: "fresh-token",
      channel: "meet",
      room: "bootstrap",
    });
    expect(bootstrap.data.rtc.turnAvailable).toBe(true);
    expect(bootstrap.session.user.username).toBe("bob");
  });
});
