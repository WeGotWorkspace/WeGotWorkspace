/**
 * @vitest-environment jsdom
 */
import { render, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchRtcSettings } from "@/lib/api/wgw/rtc";
import { PresenceProvider } from "@/presence-core/src/presence-provider";

vi.mock("@/lib/api/wgw/http", () => ({
  wgwApiBaseUrl: () => "/api/v1",
  wgwCurrentAccessToken: () => "member-token",
  wgwHasAuthenticatedSession: () => true,
  wgwIsGuestSession: () => false,
  wgwFetchPrincipal: vi.fn(async () => ({
    user: { username: "member", displayName: "Member" },
  })),
}));

vi.mock("@/lib/api/wgw/rtc", () => ({
  fetchRtcSettings: vi.fn(async () => ({
    stunUrls: "stun:example.test:3478",
    turnAvailable: true,
    forceRelay: false,
  })),
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

afterEach(() => {
  vi.clearAllMocks();
});

describe("PresenceProvider", () => {
  it("fetches workspace ICE settings with the member bearer token", async () => {
    render(createElement(PresenceProvider, null, createElement("div")));

    await waitFor(() => {
      expect(fetchRtcSettings).toHaveBeenCalledWith({
        url: "/api/v1/rooms/p_workspace/configuration",
        bearerToken: "member-token",
      });
    });
  });
});
