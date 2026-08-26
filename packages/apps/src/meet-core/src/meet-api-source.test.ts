import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceSession } from "@/lib/workspace/workspace-session";

vi.mock("@/lib/api/wgw/http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/wgw/http")>();
  return {
    ...actual,
    wgwFetchPrincipal: vi.fn(),
    wgwFetch: vi.fn(),
  };
});

vi.mock("@/lib/api/wgw/rtc", () => ({
  fetchRtcSettings: vi.fn(),
}));

import { wgwFetch, wgwFetchPrincipal } from "@/lib/api/wgw/http";
import { fetchRtcSettings } from "@/lib/api/wgw/rtc";
import {
  createWgwMeetApiSource,
  createWgwMeetGuestOrHostApiSource,
  meetGuestLinkAllowsHostUpgrade,
} from "@/meet-core/src/meet-api-source";

const fetchPrincipal = vi.mocked(wgwFetchPrincipal);
const fetchJson = vi.mocked(wgwFetch);
const rtcSettings = vi.mocked(fetchRtcSettings);

const ROOM = "h8y8-ewp6-al8n";
const HOST_SESSION: WorkspaceSession = {
  user: {
    displayName: "Bob",
    initials: "B",
    username: "bob",
    email: "bob@example.com",
  },
  viewerInboxLabel: "me",
};
const RTC = {
  stunUrls: "",
  turnUrls: "",
  turnUsername: "",
  turnPassword: "",
  forceRelay: false,
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe("createWgwMeetApiSource", () => {
  beforeEach(() => {
    fetchPrincipal.mockReset();
    fetchJson.mockReset();
    rtcSettings.mockReset().mockResolvedValue(RTC);
  });

  it("loads the signed-in principal and uses authenticated operations", async () => {
    fetchPrincipal.mockResolvedValue(HOST_SESSION);
    const source = createWgwMeetApiSource();
    const bootstrap = await source.loadBootstrap();
    const operations = source.createOperations(bootstrap);

    expect(bootstrap.session.user.username).toBe("bob");
    expect(operations?.guestSignalingFetch).toBeUndefined();
  });
});

describe("meetGuestLinkAllowsHostUpgrade", () => {
  beforeEach(() => {
    fetchPrincipal.mockReset();
    fetchJson.mockReset();
    rtcSettings.mockReset().mockResolvedValue(RTC);
  });

  it("is true for a signed-in createdBy / ownerPrincipal member", async () => {
    fetchPrincipal.mockResolvedValue(HOST_SESSION);
    fetchJson.mockResolvedValue(
      jsonResponse({
        reserved: true,
        active: false,
        ownerPrincipal: "u:bob",
        createdBy: "u:bob",
      }),
    );

    await expect(meetGuestLinkAllowsHostUpgrade(ROOM)).resolves.toBe(true);
    expect(fetchJson).toHaveBeenCalledWith(`/meetings/rooms/${ROOM}`, expect.anything());
  });

  it("is true when the manager body only includes createdBy", async () => {
    fetchPrincipal.mockResolvedValue(HOST_SESSION);
    fetchJson.mockResolvedValue(
      jsonResponse({
        reserved: true,
        active: false,
        createdBy: "u:bob",
      }),
    );

    await expect(meetGuestLinkAllowsHostUpgrade(ROOM)).resolves.toBe(true);
  });

  it("is false when there is no session", async () => {
    fetchPrincipal.mockRejectedValue(new Error("GET /me failed (401)"));

    await expect(meetGuestLinkAllowsHostUpgrade(ROOM)).resolves.toBe(false);
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("is false for a signed-in non-manager (guest GET body)", async () => {
    fetchPrincipal.mockResolvedValue(HOST_SESSION);
    fetchJson.mockResolvedValue(jsonResponse({ reserved: true, active: false }));

    await expect(meetGuestLinkAllowsHostUpgrade(ROOM)).resolves.toBe(false);
  });
});

describe("createWgwMeetGuestOrHostApiSource", () => {
  beforeEach(() => {
    fetchPrincipal.mockReset();
    fetchJson.mockReset();
    rtcSettings.mockReset().mockResolvedValue(RTC);
  });

  it("upgrades a signed-in manager on the guest URL to authenticated bootstrap and ops", async () => {
    fetchPrincipal.mockResolvedValue(HOST_SESSION);
    fetchJson.mockResolvedValue(
      jsonResponse({
        reserved: true,
        active: false,
        ownerPrincipal: "groups/design",
        createdBy: "u:bob",
      }),
    );
    const source = createWgwMeetGuestOrHostApiSource(ROOM);
    const bootstrap = await source.loadBootstrap();
    const operations = source.createOperations(bootstrap);

    expect(bootstrap.session.user.username).toBe("bob");
    expect(operations?.guestSignalingFetch).toBeUndefined();
  });

  it("keeps an anonymous visitor on guest bootstrap and signaling", async () => {
    fetchPrincipal.mockRejectedValue(new Error("GET /me failed (401)"));
    const source = createWgwMeetGuestOrHostApiSource(ROOM);
    const bootstrap = await source.loadBootstrap();
    const operations = source.createOperations(bootstrap);

    expect(bootstrap.session.user.username).toBeUndefined();
    expect(bootstrap.session.user.displayName).toBe("Guest");
    expect(operations?.guestSignalingFetch).toEqual(expect.any(Function));
  });

  it("keeps a signed-in non-manager on guest bootstrap", async () => {
    fetchPrincipal.mockResolvedValue(HOST_SESSION);
    fetchJson.mockResolvedValue(jsonResponse({ reserved: true, active: false }));
    const source = createWgwMeetGuestOrHostApiSource(ROOM);
    const bootstrap = await source.loadBootstrap();
    const operations = source.createOperations(bootstrap);

    expect(bootstrap.session.user.displayName).toBe("Guest");
    expect(operations?.guestSignalingFetch).toEqual(expect.any(Function));
  });
});
