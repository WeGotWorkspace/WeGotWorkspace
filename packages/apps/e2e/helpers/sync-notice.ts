// The "could not sync" row in an app's notice bar (#1895), and a way to make
// the write behind it fail at the network while the tab stays online.
import type { BrowserContext, Locator, Page, Route } from "@playwright/test";

/** Notes, Contacts, Calendar and Tasks. */
export const SYNC_FAILED = "Some changes could not sync. They are saved on this device.";
/** Docs and Drive also list changes the server rejected. */
export const SYNC_FAILED_FILES = `${SYNC_FAILED} Changes the server rejected stay listed.`;
/** Every app names its notice bar this (`workspaceLabels.noticeBarLabel`). */
export const NOTICE_BAR = "Needs your attention";

/** The sync row, inside the notice bar region (so never the toast). */
export function syncNoticeRow(tab: Page, text: string = SYNC_FAILED): Locator {
  return tab
    .getByRole("region", { name: NOTICE_BAR })
    .locator(".notice-bar__notice")
    .filter({ hasText: text });
}

type HoldMatch = {
  /** HTTP method as sent, after `X-HTTP-Method-Override`. */
  method: string;
  /** Matched against the full request URL. */
  url: RegExp;
  /** Also require this text in the request body (a JMAP method name, say). */
  bodyIncludes?: string;
};

/**
 * Fails matching requests at the network on the whole context (every tab), the
 * way a flaky connection does, until the returned release runs. Other requests
 * pass through.
 */
export async function holdRequests(
  context: Pick<BrowserContext, "route" | "unroute">,
  match: HoldMatch,
): Promise<() => Promise<void>> {
  const handler = async (route: Route) => {
    const request = route.request();
    // The app tunnels PATCH, PUT and DELETE through POST (`X-HTTP-Method-Override`).
    const sent = (await request.headerValue("x-http-method-override")) ?? request.method();
    const bodyHit = !match.bodyIncludes || (request.postData() ?? "").includes(match.bodyIncludes);
    if (sent === match.method && bodyHit) await route.abort("internetdisconnected");
    else await route.fallback();
  };
  await context.route(match.url, handler);
  return () => context.unroute(match.url, handler);
}
