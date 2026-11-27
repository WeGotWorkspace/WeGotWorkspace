import { randomBytes } from "node:crypto";
import { test, type BrowserContext, type Page, type Request } from "./helpers/live-test";
import { contactsJmap, createContactCards } from "./helpers/contacts-jmap";
import { docsUrlForFile, E2E_GROUP_ROOT, seedDocAtPath } from "./helpers/docs-live";
import { apiToken, openUser, OWNER, sleep } from "./helpers/live-matrix";
import {
  BUDGET,
  endpointGroup,
  overBudget,
  TrafficMeter,
  writeReport,
  type TrafficReport,
} from "./helpers/traffic-meter";

/**
 * Shared hosting traffic budget: how many requests one browser of one user
 * sends per minute. A shared host's firewall counts per IP, so every tab,
 * PWA window and device behind one router adds up (a host flagged "more than
 * 60 per minute" as automated). Measures; the numbers go in the report.
 *
 * How to run it, what the numbers mean and how to cross-check them with the
 * API server log: docs/realtime-capacity.md ("Measuring the browser budget").
 * `WGW_TRAFFIC_ENFORCE=1` fails a scenario that breaks the Epic #2284 budget;
 * without it the run only reports.
 */

const MINUTES = Number(process.env.WGW_TRAFFIC_MINUTES ?? "3");
const WINDOW_MS = MINUTES * 60_000;
const ENFORCE = process.env.WGW_TRAFFIC_ENFORCE === "1";
const API = process.env.WGW_E2E_API_URL ?? "http://127.0.0.1:9080";
/** Contacts in the cold-start book and docs in the Team folder (Epic #2284: 2000 contacts, 40 docs). */
const COLD_CONTACTS = Number(process.env.WGW_TRAFFIC_CONTACTS ?? "2000");
const COLD_DOCS = Number(process.env.WGW_TRAFFIC_DOCS ?? "40");

/** Prints the budget lines a report breaks and, when enforcing, fails the scenario. */
function check(report: TrafficReport, limits: Parameters<typeof overBudget>[1]): void {
  const broken = overBudget(report, limits);
  for (const line of broken) console.log(`[traffic] OVER BUDGET ${report.scenario}: ${line}`);
  if (ENFORCE && broken.length > 0) {
    throw new Error(`${report.scenario} is over the traffic budget: ${broken.join("; ")}`);
  }
}

test.use({ storageState: { cookies: [], origins: [] } });

type HideableWindow = { __setHidden: (hidden: boolean) => void };

/** Every Playwright page counts as visible; this lets the scenario put tabs in the background. */
async function allowHiding(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    let hidden = false;
    Object.defineProperty(Document.prototype, "hidden", { configurable: true, get: () => hidden });
    Object.defineProperty(Document.prototype, "visibilityState", {
      configurable: true,
      get: () => (hidden ? "hidden" : "visible"),
    });
    (window as unknown as HideableWindow).__setHidden = (value) => {
      hidden = value;
      document.dispatchEvent(new Event("visibilitychange"));
    };
  });
}

const setHidden = (page: Page, hidden: boolean) =>
  page.evaluate((value) => (window as unknown as HideableWindow).__setHidden(value), hidden);

async function seedDoc(): Promise<string> {
  const apiPath = `${E2E_GROUP_ROOT}/traffic-${Date.now().toString(36)}.md`;
  await seedDocAtPath(apiPath, "# Traffic\n\nSomething to read.\n");
  return apiPath;
}

/** Five tabs of one browser, as a user keeps the suite open: Docs (a document), Calendar, Contacts, Tasks, Drive. */
async function openSuite(context: BrowserContext, meter: TrafficMeter): Promise<Page[]> {
  const doc = await seedDoc();
  const routes: [string, string][] = [
    ["docs", docsUrlForFile(doc)],
    ["calendar", "/calendar"],
    ["contacts", "/contacts/all"],
    ["tasks", "/tasks"],
    ["drive", "/drive"],
  ];
  const tabs: Page[] = [];
  for (const [tag, route] of routes) {
    const tab = await context.newPage();
    meter.name(tab, tag);
    await tab.goto(route);
    tabs.push(tab);
  }
  await tabs[0]!.locator(".ProseMirror").waitFor({ timeout: 30_000 });
  // Settle: first loads and the offline downloads are not the steady state.
  await sleep(30_000);
  for (const tab of tabs.slice(1)) await setHidden(tab, true);
  await sleep(5_000);
  return tabs;
}

test("one Docs tab, idle", async ({ browser }) => {
  const context = await openUser(browser, OWNER);
  await allowHiding(context);
  const meter = new TrafficMeter(context);
  const tab = await context.newPage();
  meter.name(tab, "docs");
  await tab.goto(docsUrlForFile(await seedDoc()));
  await tab.locator(".ProseMirror").waitFor({ timeout: 30_000 });
  await sleep(30_000);
  meter.start();
  await sleep(WINDOW_MS);
  check(meter.report("docs-one-tab-idle"), {
    lastMinute: BUDGET.idlePerMinute,
    per10s: BUDGET.per10s,
  });
  await context.close();
});

test("one Docs tab, the user clicks in it every 20 s", async ({ browser }) => {
  const context = await openUser(browser, OWNER);
  await allowHiding(context);
  const meter = new TrafficMeter(context);
  const tab = await context.newPage();
  meter.name(tab, "docs");
  await tab.goto(docsUrlForFile(await seedDoc()));
  await tab.locator(".ProseMirror").waitFor({ timeout: 30_000 });
  await sleep(30_000);
  meter.start();
  const end = Date.now() + WINDOW_MS;
  while (Date.now() < end) {
    await tab.locator(".ProseMirror").click({ position: { x: 5, y: 5 } });
    await sleep(20_000);
  }
  check(meter.report("docs-one-tab-active"), {
    perMinute: BUDGET.activePerMinute,
    per10s: BUDGET.per10s,
  });
  await context.close();
});

test("five apps in five tabs, Docs in front, idle", async ({ browser }) => {
  const context = await openUser(browser, OWNER);
  await allowHiding(context);
  const meter = new TrafficMeter(context);
  await openSuite(context, meter);
  meter.start();
  await sleep(WINDOW_MS);
  check(meter.report("suite-five-tabs-idle"), {
    lastMinute: BUDGET.idlePerMinute,
    per10s: BUDGET.per10s,
  });
  await context.close();
});

test("five apps, the user switches tab every 15 s", async ({ browser }) => {
  const context = await openUser(browser, OWNER);
  await allowHiding(context);
  const meter = new TrafficMeter(context);
  const tabs = await openSuite(context, meter);
  meter.start();
  let front = 0;
  const end = Date.now() + WINDOW_MS;
  while (Date.now() < end) {
    await sleep(15_000);
    const next = (front + 1) % tabs.length;
    await setHidden(tabs[front]!, true);
    await setHidden(tabs[next]!, false);
    front = next;
  }
  check(meter.report("suite-tab-switching"), {
    perMinute: BUDGET.activePerMinute,
    per10s: BUDGET.per10s,
  });
  await context.close();
});

/**
 * The host's log named these two referers: Calendar week (the task overlay's
 * `GET /tasks/items`) and Contacts (the push stream). Calendar and Contacts in
 * two tabs, the user switching between them every 15 s.
 */
test("Calendar week and Contacts, the user switches between them every 15 s", async ({
  browser,
}) => {
  const context = await openUser(browser, OWNER);
  await allowHiding(context);
  const meter = new TrafficMeter(context);
  const calendar = await context.newPage();
  meter.name(calendar, "calendar");
  await calendar.goto("/calendar");
  const contacts = await context.newPage();
  meter.name(contacts, "contacts");
  await contacts.goto("/contacts/all");
  await sleep(30_000);
  await setHidden(calendar, true);
  meter.start();
  const tabs = [contacts, calendar];
  let front = 0;
  const end = Date.now() + WINDOW_MS;
  while (Date.now() < end) {
    await sleep(15_000);
    await setHidden(tabs[front]!, true);
    front = 1 - front;
    await setHidden(tabs[front]!, false);
  }
  check(meter.report("calendar-contacts-switching"), {
    perMinute: BUDGET.activePerMinute,
    per10s: BUDGET.per10s,
  });
  await context.close();
});

test("five apps, the connection drops for 60 s and comes back", async ({ browser }) => {
  const context = await openUser(browser, OWNER);
  await allowHiding(context);
  const meter = new TrafficMeter(context);
  await openSuite(context, meter);
  meter.start();
  await sleep(30_000);
  await meter.blockApi();
  await sleep(60_000);
  await meter.unblockApi();
  await sleep(Math.max(60_000, WINDOW_MS - 90_000));
  check(meter.report("suite-connection-drop"), { per10s: BUDGET.per10s });
  await context.close();
});

/**
 * A fresh browser (no offline data, as after an update that resets the cache
 * or on a new device) opens the suite while the Team folder holds 40
 * documents and the address book 2000 contacts. Counts the first minutes,
 * start-up downloads included. The seed is topped up, never removed, so a
 * second run starts from the same book.
 */
test("cold start: a fresh browser opens five apps, 2000 contacts, Team folder with 40 docs", async ({
  browser,
}) => {
  for (let index = 0; index < COLD_DOCS; index += 1) {
    await seedDocAtPath(
      `${E2E_GROUP_ROOT}/traffic-cold-${String(index).padStart(3, "0")}.md`,
      `# Doc ${index}\n\nBody ${index}.\n`,
    );
  }
  const [[, existing]] = await contactsJmap([["ContactCard/query", { accountId: OWNER }, "q"]]);
  const have = ((existing.ids as string[] | undefined) ?? []).length;
  for (let from = have; from < COLD_CONTACTS; from += 40) {
    const size = Math.min(40, COLD_CONTACTS - from);
    await createContactCards(
      Array.from({ length: size }, (_, offset) => {
        const n = from + offset;
        return {
          "@type": "Card",
          version: "1.0",
          addressBookIds: { default: true },
          name: { "@type": "Name", full: `Traffic Contact ${String(n).padStart(4, "0")}` },
          emails: { e1: { address: `traffic-${n}@example.test` } },
        };
      }),
    );
  }
  const context = await openUser(browser, OWNER);
  await allowHiding(context);
  const meter = new TrafficMeter(context);
  meter.start();
  const routes: [string, string][] = [
    ["docs", "/docs"],
    ["calendar", "/calendar"],
    ["contacts", "/contacts/all"],
    ["tasks", "/tasks"],
    ["drive", "/drive"],
  ];
  for (const [tag, route] of routes) {
    const tab = await context.newPage();
    meter.name(tab, tag);
    await tab.goto(route);
    await sleep(3_000);
  }
  await sleep(Math.max(120_000, WINDOW_MS - 15_000));
  check(
    meter.report("suite-cold-start", { contacts: Math.max(have, COLD_CONTACTS), docs: COLD_DOCS }),
    {
      minuteOne: BUDGET.coldMinuteOne,
      after: BUDGET.coldAfterPerMinute,
    },
  );
  await context.close();
});

/** Longest a tree cold start may run before the report is written anyway (minutes). */
const TREE_MAX_MINUTES = Number(process.env.WGW_TRAFFIC_TREE_MAX_MINUTES ?? "30");
/** The first sync is over once no listing request was sent for this long. */
const TREE_QUIET_MS = 90_000;

/**
 * A request that lists files: a JMAP request with `FileNode/query`, the search
 * route Docs home listed through before #2063, and the REST listings.
 */
function isListingRequest(request: Request): boolean {
  const { pathname } = new URL(request.url());
  if (pathname.endsWith("/jmap")) {
    return request.method() === "POST" && (request.postData() ?? "").includes('"FileNode/query"');
  }
  return /^\/api\/v1\/(search\/results|files\/(children|starred|shared-with-me))$/.test(pathname);
}

/**
 * What one listing request asks for: the keyset walk (`idAfter` / `asOfState`,
 * #2063), a folder listing (`parentId`), another `FileNode/query` filter, or a
 * REST route. Tells the walk apart from the listings a view sends.
 */
function listingKind(request: Request): string {
  const url = new URL(request.url());
  if (!url.pathname.endsWith("/jmap")) return `GET ${url.pathname.replace(/^\/api\/v1/, "")}`;
  type Call = [string, Record<string, unknown>, string];
  let calls: Call[] = [];
  try {
    calls = (JSON.parse(request.postData() ?? "{}") as { methodCalls?: Call[] }).methodCalls ?? [];
  } catch {
    return "POST /jmap (unreadable)";
  }
  const queries = calls.filter(([name]) => name === "FileNode/query").map(([, args]) => args);
  const walk = queries.some((args) =>
    ["idAfter", "#idAfter", "asOfState", "#asOfState"].some((key) => key in args),
  );
  if (walk) return `walk (${queries.length} pages)`;
  const filter = (queries[0]?.filter ?? null) as Record<string, unknown> | null;
  const keys = filter ? Object.keys(filter).sort().join(",") : "none";
  return `FileNode/query filter ${keys} (${queries.length} per request)`;
}

/**
 * #2063: a fresh browser opens one app on a large file tree, alone. Counts the
 * listing requests until the first sync is over (no listing for 90 s). The
 * tree is seeded beside the run (docs/realtime-capacity.md, "Cold start on a
 * large tree"), so the build before and after the change meet the same data.
 */
for (const [app, route] of [
  ["drive", "/drive"],
  ["docs", "/docs"],
] as const) {
  test(`cold start on a large tree: ${app} alone`, async ({ browser }) => {
    test.setTimeout((TREE_MAX_MINUTES + 5) * 60_000);
    const context = await openUser(browser, OWNER);
    const meter = new TrafficMeter(context);
    meter.start();
    const tab = await context.newPage();
    meter.name(tab, app);
    // Only for the end of the run; the meter does the counting.
    let lastListing = Date.now();
    const kinds = new Map<string, number>();
    const groups = new Map<string, number>();
    context.on("request", (request) => {
      if (!isListingRequest(request)) return;
      lastListing = Date.now();
      // The page's own requests; a worker that forwards one sends the same body again.
      if (request.serviceWorker()) return;
      const group = endpointGroup(request);
      groups.set(group, (groups.get(group) ?? 0) + 1);
      const kind = listingKind(request);
      kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
    });
    const startedAt = Date.now();
    await tab.goto(route);
    while (
      Date.now() - lastListing < TREE_QUIET_MS &&
      Date.now() - startedAt < TREE_MAX_MINUTES * 60_000
    ) {
      await sleep(5_000);
    }
    const lastListingSeconds = Math.round((lastListing - startedAt) / 1000);
    const report = meter.report(`tree-cold-start-${app}`, { app, lastListingSeconds });
    const listingGroups = Object.fromEntries(groups);
    const listingKinds = Object.fromEntries(kinds);
    const listingRequests = [...kinds.values()].reduce((sum, count) => sum + count, 0);
    writeReport(`tree-cold-start-${app}`, {
      ...report,
      listingRequests,
      listingKinds,
      listingGroups,
    });
    console.log(`[traffic] tree-cold-start-${app} listings: ${JSON.stringify(listingKinds)}`);
    console.log(
      `[traffic] tree-cold-start-${app}: ${listingRequests} listing requests, the last after ${lastListingSeconds} s`,
    );
    await context.close();
  });
}

/**
 * The cost of one push request with every type (`GET /jmap/events/*`), the
 * request every open browser sends every few seconds. Budget ≤ 25 ms on the
 * reference stack (14 ms for 13 types when measured; the server knows 16 types
 * now). No browser: plain requests in a row, the first one only to learn the
 * `Last-Event-ID`, so each answer is the steady "nothing changed" case that
 * almost every request is. Reported as client-side round trip, which includes
 * a local socket; compare it with the server log, not with a WAN browser.
 */
test("push request with every type: duration", async () => {
  const samples = Number(process.env.WGW_TRAFFIC_PUSH_SAMPLES ?? "200");
  const url = `${API}/api/v1/jmap/events/*/state/0`;
  // The push route allows 60 requests a minute per browser id and 300 per account:
  // a new browser id every 50 requests keeps a fast run under both.
  const auth = `Bearer ${await apiToken(OWNER)}`;
  let headers: Record<string, string> = {};
  const newBrowser = () => {
    headers = { Authorization: auth, "X-WGW-Browser-Id": randomBytes(16).toString("hex") };
  };
  newBrowser();
  const first = await fetch(url, { headers });
  const eventId = /^id: (.+)$/m.exec(await first.text())?.[1] ?? "";
  const startedAt = Date.now();
  const durations: number[] = [];
  for (let n = 0; n < samples + 10; n += 1) {
    if (n > 0 && n % 50 === 0) newBrowser();
    const began = performance.now();
    const res = await fetch(url, { headers: { ...headers, "Last-Event-ID": eventId } });
    await res.text();
    if (!res.ok) throw new Error(`push request answered ${res.status}`);
    if (n >= 10) durations.push(performance.now() - began); // the first 10 warm the caches
  }
  durations.sort((a, b) => a - b);
  const at = (q: number) =>
    +durations[Math.min(durations.length - 1, Math.floor(q * durations.length))]!.toFixed(1);
  const median = at(0.5);
  writeReport("push-request-duration", {
    scenario: "push-request-duration",
    startedAt,
    endedAt: Date.now(),
    samples: durations.length,
    medianMs: median,
    p95Ms: at(0.95),
    maxMs: at(1),
    budgetMs: BUDGET.pushRequestMs,
    learnedEventId: eventId !== "",
  });
  if (ENFORCE && median > BUDGET.pushRequestMs) {
    throw new Error(`push request median ${median} ms is over ${BUDGET.pushRequestMs} ms`);
  }
});
