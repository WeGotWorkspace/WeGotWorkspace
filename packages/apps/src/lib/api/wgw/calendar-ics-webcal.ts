import { wgwErrorMessageFromBody, wgwFetch, wgwReadJson } from "@/lib/api/wgw/http";
import type {
  CalendarFeed,
  CalendarSubscription,
  CalendarSubscriptionCreateRequest,
  CalendarSubscriptionListResponse,
} from "@wgw-api-generated/calendars-types";

/** Refresh remote ICS when last fetch is older than one hour (owner Calendar load). */
export const CALENDAR_SUBSCRIPTION_STALE_MS = 60 * 60 * 1000;

async function throwUnlessOk(res: Response, method: string, path: string): Promise<void> {
  if (res.ok || res.status === 204) return;
  const detail = wgwErrorMessageFromBody(await res.text(), res.status, res.statusText);
  throw new Error(`${method} ${path} failed (${res.status}): ${detail}`);
}

async function readOkJson<T>(res: Response, method: string, path: string): Promise<T> {
  await throwUnlessOk(res, method, path);
  return (await wgwReadJson(res)) as T;
}

export async function listCalendarSubscriptionsLive(): Promise<CalendarSubscription[]> {
  const path = "/calendars/subscriptions";
  const res = await wgwFetch(path);
  const body = await readOkJson<CalendarSubscriptionListResponse>(res, "GET", path);
  return Array.isArray(body.list) ? body.list : [];
}

export async function createCalendarSubscriptionLive(
  draft: CalendarSubscriptionCreateRequest,
): Promise<CalendarSubscription> {
  const path = "/calendars/subscriptions";
  const res = await wgwFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(draft),
  });
  return readOkJson<CalendarSubscription>(res, "POST", path);
}

export async function getCalendarSubscriptionLive(id: string): Promise<CalendarSubscription> {
  const path = `/calendars/subscriptions/${encodeURIComponent(id)}`;
  const res = await wgwFetch(path);
  return readOkJson<CalendarSubscription>(res, "GET", path);
}

export async function deleteCalendarSubscriptionLive(id: string): Promise<void> {
  const path = `/calendars/subscriptions/${encodeURIComponent(id)}`;
  const res = await wgwFetch(path, { method: "DELETE" });
  await throwUnlessOk(res, "DELETE", path);
}

export async function refreshCalendarSubscriptionLive(id: string): Promise<CalendarSubscription> {
  const path = `/calendars/subscriptions/${encodeURIComponent(id)}/refresh`;
  const res = await wgwFetch(path, { method: "POST" });
  return readOkJson<CalendarSubscription>(res, "POST", path);
}

export async function getCalendarFeedLive(calendarId: string): Promise<CalendarFeed | null> {
  const path = `/calendars/${encodeURIComponent(calendarId)}/feed`;
  const res = await wgwFetch(path);
  if (res.status === 404) return null;
  return readOkJson<CalendarFeed>(res, "GET", path);
}

export async function publishCalendarFeedLive(calendarId: string): Promise<CalendarFeed> {
  const path = `/calendars/${encodeURIComponent(calendarId)}/feed`;
  const res = await wgwFetch(path, { method: "POST" });
  return readOkJson<CalendarFeed>(res, "POST", path);
}

export async function unpublishCalendarFeedLive(calendarId: string): Promise<void> {
  const path = `/calendars/${encodeURIComponent(calendarId)}/feed`;
  const res = await wgwFetch(path, { method: "DELETE" });
  await throwUnlessOk(res, "DELETE", path);
}

export function subscriptionIsStale(
  lastFetchedAt: string | null | undefined,
  now = Date.now(),
): boolean {
  if (!lastFetchedAt) return true;
  const fetched = Date.parse(lastFetchedAt);
  return !Number.isFinite(fetched) || now - fetched >= CALENDAR_SUBSCRIPTION_STALE_MS;
}

export async function refreshStaleCalendarSubscriptionsLive(): Promise<boolean> {
  const list = await listCalendarSubscriptionsLive();
  let refreshed = false;
  for (const subscription of list) {
    if (!subscriptionIsStale(subscription.lastFetchedAt)) continue;
    await refreshCalendarSubscriptionLive(subscription.id);
    refreshed = true;
  }
  return refreshed;
}
