import { beforeEach, describe, expect, it, vi } from "vitest";

const wgwFetch = vi.fn();
const guest = vi.fn(() => false);
const apiBase = vi.fn(() => "/api/v1");

vi.mock("@/lib/api/wgw/http", () => ({
  wgwApiBaseUrl: () => apiBase(),
  wgwFetch: (path: string, init: RequestInit) => wgwFetch(path, init),
  wgwIsGuestSession: () => guest(),
  wgwLiveApiEnabled: () => false,
  wgwAwaitSessionRefreshForReconnect: async () => undefined,
}));

const { eventSourcePath, resolveEventSourcePath } = await import("./jmap-push");

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("eventSourcePath", () => {
  it("expands the session template to an API-relative path", () => {
    expect(
      eventSourcePath(
        "https://suite.example/api/v1/jmap/events/{types}/{closeafter}/{ping}",
        "https://suite.example",
      ),
    ).toBe("/jmap/events/*/state/0");
  });

  it("also strips an absolute API base, which wgwFetch adds again", () => {
    apiBase.mockReturnValueOnce("https://suite.example/api/v1");
    expect(
      eventSourcePath(
        "https://suite.example/api/v1/jmap/events/{types}/{closeafter}/{ping}",
        "https://app.example",
      ),
    ).toBe("/jmap/events/*/state/0");
  });

  it("keeps a path outside the API base as it is", () => {
    expect(eventSourcePath("/push/{types}/{closeafter}/{ping}", "https://suite.example")).toBe(
      "/push/*/state/0",
    );
  });
});

describe("resolveEventSourcePath", () => {
  beforeEach(() => {
    wgwFetch.mockReset();
    guest.mockReturnValue(false);
  });

  it("reads eventSourceUrl from the JMAP session", async () => {
    wgwFetch.mockResolvedValue(
      json({ eventSourceUrl: "http://localhost/api/v1/jmap/events/{types}/{closeafter}/{ping}" }),
    );
    await expect(resolveEventSourcePath("http://localhost")).resolves.toBe(
      "/jmap/events/*/state/0",
    );
    expect(wgwFetch).toHaveBeenCalledWith("/jmap/session", expect.anything());
  });

  it("is null when the session advertises no event source", async () => {
    wgwFetch.mockResolvedValue(json({}));
    await expect(resolveEventSourcePath("http://localhost")).resolves.toBeNull();
  });

  it("is null for a guest share session, which cannot use push", async () => {
    guest.mockReturnValue(true);
    await expect(resolveEventSourcePath("http://localhost")).resolves.toBeNull();
    expect(wgwFetch).not.toHaveBeenCalled();
  });

  it("throws on a failed session request so the transport backs off", async () => {
    wgwFetch.mockResolvedValue(json({}, 503));
    await expect(resolveEventSourcePath("http://localhost")).rejects.toMatchObject({ status: 503 });
  });
});
