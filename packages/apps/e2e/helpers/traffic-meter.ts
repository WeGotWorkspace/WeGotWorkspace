import fs from "node:fs";
import path from "node:path";
import type { BrowserContext, Page, Request } from "@playwright/test";

/** One counted request: when, which tab, and the endpoint group it falls in. */
type Hit = { at: number; tab: string; group: string; blocked: boolean };

/**
 * Replaces ids, tokens and query values so requests to the same endpoint land
 * in one group: `/api/v1/tasks/items?taskListId=x` → `GET /tasks/items?taskListId`.
 */
export function endpointGroup(request: Request): string {
  const url = new URL(request.url());
  let p = url.pathname.replace(/^\/api\/v1/, "");
  if (!url.pathname.startsWith("/api/")) {
    if (
      /\.(js|css|mjs|png|svg|woff2|ico|mp3|webmanifest|json|ts|tsx)$/.test(p) ||
      p.startsWith("/@") ||
      p.startsWith("/node_modules/") ||
      p.startsWith("/src/")
    ) {
      return "asset";
    }
    return `${request.method()} page ${p.split("/")[1] ?? ""}`;
  }
  p = p
    .replace(/\/jmap\/events\/[^/]+\/[^/]+\/[^/]+$/, "/jmap/events/{types}/{closeafter}/{ping}")
    .replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "/{id}")
    .replace(/\/\d+(?=\/|$)/g, "/{n}")
    .replace(
      /\/(rooms|items|files|nodes|threads|calendars|tasklists|books|notebooks)\/[^/]+/g,
      "/$1/{id}",
    );
  const keys = [...url.searchParams.keys()].sort().join("&");
  let label = `${request.method()} ${p}${keys ? `?${keys}` : ""}`;
  if (p === "/jmap" && request.method() === "POST") {
    try {
      const body = JSON.parse(request.postData() ?? "{}") as { methodCalls?: [string][] };
      const methods = (body.methodCalls ?? []).map((call) => call[0]).join("+");
      if (methods) label = `POST /jmap ${methods}`;
    } catch {
      // keep the plain label
    }
  }
  return label;
}

/** A request is the same one when method and URL match; the worker's fetch and the page's request share both. */
const requestKey = (request: Request) => `${request.method()} ${request.url()}`;

/** How long a worker fetch vouches for a failed page request of the same URL (ms). */
const WORKER_VOUCH_MS = 10_000;

/**
 * Counts the requests of one browser context, per tab and per endpoint group.
 *
 * It counts what reaches the server. With service worker network events on
 * (`PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1`, set by
 * `playwright.traffic.config.mjs`), the worker's own fetches show as requests
 * with `serviceWorker()` set. A page request the worker answered (from its
 * cache, or by forwarding it) is skipped, so a coalesced read counts once and a
 * forwarded one is not counted twice. A page request that failed while the
 * worker fetched the same URL a moment ago failed inside the worker, whose own
 * fetch already counted. This holds with and without a worker that governs
 * traffic, so one meter measures both builds.
 */
export class TrafficMeter {
  private hits: Hit[] = [];
  private tabs = new Map<Page, string>();
  private workerFetches = new Map<string, number>();
  /** When each page request left, so a slow answer is counted in the minute it was sent, as the server's log does. */
  private sentAt = new WeakMap<Request, number>();
  private started = 0;
  private blocking = false;

  constructor(private readonly context: BrowserContext) {
    context.on("request", (request) => {
      if (!this.started) return;
      if (!request.serviceWorker()) {
        this.sentAt.set(request, Date.now());
        return;
      }
      this.workerFetches.set(requestKey(request), Date.now());
      this.count(request, "sw", Date.now());
    });
    const settle = async (request: Request, failed: boolean) => {
      if (!this.started || request.serviceWorker()) return;
      const response = failed ? null : await request.response().catch(() => null);
      if (response?.fromServiceWorker()) return;
      if (failed) {
        const vouched = this.workerFetches.get(requestKey(request));
        if (vouched !== undefined && Date.now() - vouched < WORKER_VOUCH_MS) return;
      }
      const page = request.frame()?.page();
      this.count(
        request,
        (page && this.tabs.get(page)) ?? "other",
        this.sentAt.get(request) ?? Date.now(),
      );
    };
    context.on("requestfinished", (request) => void settle(request, false));
    context.on("requestfailed", (request) => void settle(request, true));
  }

  private count(request: Request, tab: string, at: number): void {
    const group = endpointGroup(request);
    if (group === "asset") return;
    this.hits.push({ at, tab, group, blocked: this.blocking });
  }

  name(page: Page, tab: string): void {
    this.tabs.set(page, tab);
  }

  start(): void {
    this.hits = [];
    this.workerFetches.clear();
    this.started = Date.now();
  }

  /** From now on every API request fails as a dropped connection does (a firewall ban). */
  async blockApi(): Promise<void> {
    this.blocking = true;
    await this.context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      const probe = route.request().method() === "HEAD" && url.pathname === "/";
      if (probe || url.pathname.startsWith("/api/")) return route.abort("connectionfailed");
      return route.continue();
    });
  }

  async unblockApi(): Promise<void> {
    await this.context.unroute("**/*");
    this.blocking = false;
  }

  /** Writes the report and returns it. */
  report(scenario: string, notes: Record<string, unknown> = {}): TrafficReport {
    const end = Date.now();
    this.hits.sort((a, b) => a.at - b.at);
    // A few seconds over a whole minute (set-up jitter) do not open an empty extra minute.
    const minutes = Math.max(1, Math.ceil((end - this.started - 10_000) / 60_000));
    const perMinute = Array.from({ length: minutes }, () => 0);
    const byGroup = new Map<string, number>();
    const byTab = new Map<string, number>();
    const minuteOne = new Map<string, number>();
    for (const hit of this.hits) {
      perMinute[Math.min(minutes - 1, Math.floor((hit.at - this.started) / 60_000))]! += 1;
      byGroup.set(hit.group, (byGroup.get(hit.group) ?? 0) + 1);
      byTab.set(hit.tab, (byTab.get(hit.tab) ?? 0) + 1);
      if (hit.at - this.started < 60_000) {
        minuteOne.set(hit.group, (minuteOne.get(hit.group) ?? 0) + 1);
      }
    }
    const span = (end - this.started) / 60_000;
    const sorted = (map: Map<string, number>) =>
      Object.fromEntries(
        [...map.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([key, count]) => [key, { total: count, perMin: +(count / span).toFixed(1) }]),
      );
    const out: TrafficReport = {
      scenario,
      // Window in epoch ms, to line up with the API server's own request log.
      startedAt: this.started,
      endedAt: end,
      minutes: +span.toFixed(2),
      total: this.hits.length,
      perMinuteAvg: +(this.hits.length / span).toFixed(1),
      perMinute,
      peakPer10s: this.peak(10_000),
      blockedAttempts: this.hits.filter((hit) => hit.blocked).length,
      byTab: sorted(byTab),
      byGroup: sorted(byGroup),
      byGroupMinuteOne: Object.fromEntries(
        [...minuteOne.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25),
      ),
      // Seconds since start, tab, group: which route fires when.
      timeline: this.hits.map((hit) => [
        +((hit.at - this.started) / 1000).toFixed(1),
        hit.tab,
        hit.group,
      ]),
      ...notes,
    };
    writeReport(scenario, out);
    return out;
  }

  private peak(windowMs: number): number {
    let best = 0;
    let lo = 0;
    for (let hi = 0; hi < this.hits.length; hi += 1) {
      while (this.hits[hi]!.at - this.hits[lo]!.at > windowMs) lo += 1;
      best = Math.max(best, hi - lo + 1);
    }
    return best;
  }
}

export type TrafficReport = {
  scenario: string;
  startedAt: number;
  endedAt: number;
  minutes: number;
  total: number;
  perMinuteAvg: number;
  perMinute: number[];
  peakPer10s: number;
  blockedAttempts: number;
  byTab: Record<string, { total: number; perMin: number }>;
  byGroup: Record<string, { total: number; perMin: number }>;
  byGroupMinuteOne: Record<string, number>;
  timeline: [number, string, string][];
  [key: string]: unknown;
};

/** `test-results/traffic/<scenario>.json`, or `WGW_TRAFFIC_OUT` when set. */
export function writeReport(scenario: string, out: Record<string, unknown>): void {
  const dir = process.env.WGW_TRAFFIC_OUT ?? path.join(process.cwd(), "test-results", "traffic");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${scenario}.json`), JSON.stringify(out, null, 2));
  const { perMinute, perMinuteAvg, peakPer10s } = out as Partial<TrafficReport>;
  const line =
    perMinute === undefined
      ? Object.fromEntries(Object.entries(out).filter(([key]) => key !== "timeline"))
      : { perMinuteAvg, perMinute, peakPer10s };
  console.log(`[traffic] ${scenario}: ${JSON.stringify(line)}`);
}

/**
 * The per-browser budget of Epic #2284 (`docs/realtime-capacity.md`). With
 * `WGW_TRAFFIC_ENFORCE=1` a scenario over its budget fails; without it the
 * report only says so, because a measuring run is not a gate.
 */
export const BUDGET = {
  activePerMinute: 30,
  idlePerMinute: 10,
  hiddenPerMinute: 4,
  per10s: 30,
  coldMinuteOne: 120,
  coldAfterPerMinute: 40,
  pushRequestMs: 25,
} as const;

/** Returns the budget lines a report breaks (empty when it keeps them all). */
export function overBudget(
  report: TrafficReport,
  limits: {
    perMinute?: number;
    lastMinute?: number;
    per10s?: number;
    minuteOne?: number;
    after?: number;
  },
): string[] {
  const broken: string[] = [];
  const minutes = report.perMinute;
  if (limits.perMinute !== undefined && report.perMinuteAvg > limits.perMinute) {
    broken.push(`${report.perMinuteAvg}/min on average, budget ${limits.perMinute}`);
  }
  // The last full minute: the browser has been untouched for over 2 minutes by then.
  const last = minutes.length >= 3 ? minutes[minutes.length - 1] : undefined;
  if (limits.lastMinute !== undefined && last !== undefined && last > limits.lastMinute) {
    broken.push(`${last} in the last minute, budget ${limits.lastMinute}`);
  }
  if (limits.per10s !== undefined && report.peakPer10s > limits.per10s) {
    broken.push(`${report.peakPer10s} in the busiest 10 s, budget ${limits.per10s}`);
  }
  if (limits.minuteOne !== undefined && (minutes[0] ?? 0) >= limits.minuteOne) {
    broken.push(`${minutes[0]} in minute 1, budget < ${limits.minuteOne}`);
  }
  if (limits.after !== undefined) {
    minutes.slice(1).forEach((count, index) => {
      if (count >= limits.after!)
        broken.push(`${count} in minute ${index + 2}, budget < ${limits.after}`);
    });
  }
  return broken;
}
