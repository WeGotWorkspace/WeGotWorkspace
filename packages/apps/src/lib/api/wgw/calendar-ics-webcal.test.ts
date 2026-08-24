import { afterEach, describe, expect, it, vi } from "vitest";

const { wgwFetch, wgwReadJson } = vi.hoisted(() => ({
  wgwFetch: vi.fn(),
  wgwReadJson: vi.fn(),
}));

vi.mock("@/lib/api/wgw/http", () => ({
  wgwFetch,
  wgwReadJson,
  wgwErrorMessageFromBody: (body: string, status: number) => body || `HTTP ${status}`,
}));

import {
  createCalendarSubscriptionLive,
  getCalendarFeedLive,
  publishCalendarFeedLive,
  refreshStaleCalendarSubscriptionsLive,
  subscriptionIsStale,
  unpublishCalendarFeedLive,
} from "@/lib/api/wgw/calendar-ics-webcal";

function jsonResponse(status: number, body: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 404 ? "Not Found" : "OK",
    text: async () => JSON.stringify(body),
  } as Response;
}

describe("calendar ICS/webcal REST client", () => {
  afterEach(() => {
    wgwFetch.mockReset();
    wgwReadJson.mockReset();
  });

  it("posts a subscribe body and returns the subscription", async () => {
    wgwFetch.mockResolvedValue(jsonResponse(201));
    wgwReadJson.mockResolvedValue({
      id: "sub-1",
      url: "https://feeds.example.test/holidays.ics",
      calendarId: "holidays",
    });

    const created = await createCalendarSubscriptionLive({
      url: "webcal://feeds.example.test/holidays.ics",
      name: "Holidays",
    });

    expect(wgwFetch).toHaveBeenCalledWith("/calendars/subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: "webcal://feeds.example.test/holidays.ics",
        name: "Holidays",
      }),
    });
    expect(created.calendarId).toBe("holidays");
  });

  it("forwards groupSlug on subscribe so the collection lands on a team principal", async () => {
    wgwFetch.mockResolvedValue(jsonResponse(201));
    wgwReadJson.mockResolvedValue({
      id: "sub-team",
      url: "https://feeds.example.test/holidays.ics",
      name: "ICS Holidays",
      calendarId: "team-holidays",
    });

    await createCalendarSubscriptionLive({
      url: "https://feeds.example.test/holidays.ics",
      groupSlug: "team",
    });

    expect(wgwFetch).toHaveBeenCalledWith("/calendars/subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: "https://feeds.example.test/holidays.ics",
        groupSlug: "team",
      }),
    });
  });

  it("treats GET feed 404 as unpublished", async () => {
    wgwFetch.mockResolvedValue(jsonResponse(404));
    await expect(getCalendarFeedLive("default")).resolves.toBeNull();
    expect(wgwReadJson).not.toHaveBeenCalled();
  });

  it("publishes and unpublishes a calendar feed", async () => {
    wgwFetch.mockResolvedValueOnce(jsonResponse(201));
    wgwReadJson.mockResolvedValueOnce({
      httpsUrl: "https://example.test/api/v1/calendars/feeds/abc",
      webcalUrl: "webcal://example.test/api/v1/calendars/feeds/abc",
    });
    const published = await publishCalendarFeedLive("default");
    expect(wgwFetch).toHaveBeenCalledWith("/calendars/default/feed", { method: "POST" });
    expect(published.webcalUrl.startsWith("webcal://")).toBe(true);

    wgwFetch.mockResolvedValueOnce(jsonResponse(204));
    await unpublishCalendarFeedLive("default");
    expect(wgwFetch).toHaveBeenCalledWith("/calendars/default/feed", { method: "DELETE" });
  });

  it("refreshes only stale subscriptions", async () => {
    wgwFetch.mockResolvedValueOnce(jsonResponse(200));
    wgwReadJson.mockResolvedValueOnce({
      list: [
        {
          id: "fresh",
          url: "https://a.test/a.ics",
          calendarId: "a",
          lastFetchedAt: new Date().toISOString(),
        },
        {
          id: "stale",
          url: "https://b.test/b.ics",
          calendarId: "b",
          lastFetchedAt: "2020-01-01T00:00:00Z",
        },
      ],
    });
    wgwFetch.mockResolvedValueOnce(jsonResponse(200));
    wgwReadJson.mockResolvedValueOnce({
      id: "stale",
      url: "https://b.test/b.ics",
      calendarId: "b",
    });

    await expect(refreshStaleCalendarSubscriptionsLive()).resolves.toBe(true);
    expect(wgwFetch).toHaveBeenCalledWith("/calendars/subscriptions/stale/refresh", {
      method: "POST",
    });
    expect(wgwFetch).not.toHaveBeenCalledWith("/calendars/subscriptions/fresh/refresh", {
      method: "POST",
    });
  });

  it("marks missing lastFetchedAt as stale", () => {
    expect(subscriptionIsStale(null)).toBe(true);
    expect(subscriptionIsStale(new Date().toISOString())).toBe(false);
  });
});
