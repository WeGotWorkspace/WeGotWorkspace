import { expect, type APIRequestContext, type ConsoleMessage, type Page } from "@playwright/test";

const API = process.env.WGW_E2E_API_URL ?? "http://127.0.0.1:9080";

export type RtcConsoleEvent = {
  channel: string;
  event: string;
  peerId?: string;
  details: Record<string, unknown> | null;
};

type Waiter = {
  matches: (event: RtcConsoleEvent) => boolean;
  resolve: (event: RtcConsoleEvent) => void;
  timer: ReturnType<typeof setTimeout>;
};

function parseRtcPrefix(
  prefix: string,
): Pick<RtcConsoleEvent, "channel" | "event" | "peerId"> | null {
  if (!prefix.startsWith("[rtc]")) return null;
  const parts = prefix.replace(/^\[/, "").replace(/\]$/, "").split("][");
  if (parts[0] !== "rtc" || parts.length < 3) return null;
  if (parts.length === 3) return { channel: parts[1] ?? "", event: parts[2] ?? "" };
  return { channel: parts[1] ?? "", peerId: parts[2], event: parts[3] ?? "" };
}

async function readDetails(message: ConsoleMessage): Promise<Record<string, unknown> | null> {
  const second = message.args()[1];
  if (!second) return null;
  try {
    const value = await second.jsonValue();
    if (value && typeof value === "object") return value as Record<string, unknown>;
  } catch {
    return null;
  }
  return null;
}

function summarizeRtcEvent(item: RtcConsoleEvent): string {
  const details = item.details;
  if (!details) return `${item.channel}:${item.event}`;
  const pair = details.selectedPair;
  const localType =
    pair && typeof pair === "object" ? (pair as { localType?: unknown }).localType : undefined;
  const bits = [
    details.forceRelay,
    details.turnAvailable,
    details.iceTransportPolicy,
    details.mode,
    details.outcome,
    details.error,
    localType,
  ].filter((value) => value !== undefined && value !== null && value !== "");
  if (bits.length === 0) return `${item.channel}:${item.event}`;
  return `${item.channel}:${item.event}(${bits.join("/")})`;
}

/** Console lines whose first argument starts with `[rtc]`. */
export function collectRtcEvents(page: Page): {
  events: () => RtcConsoleEvent[];
  waitFor: (
    event: string,
    predicate?: (event: RtcConsoleEvent) => boolean,
    timeoutMs?: number,
  ) => Promise<RtcConsoleEvent>;
} {
  const events: RtcConsoleEvent[] = [];
  const waiters: Waiter[] = [];

  page.on("console", (message) => {
    void (async () => {
      const first = message.args()[0];
      const prefix = first ? await first.jsonValue().catch(() => "") : "";
      if (typeof prefix !== "string") return;
      const parsed = parseRtcPrefix(prefix);
      if (!parsed) return;
      const record: RtcConsoleEvent = { ...parsed, details: await readDetails(message) };
      events.push(record);
      for (const waiter of [...waiters]) {
        if (!waiter.matches(record)) continue;
        clearTimeout(waiter.timer);
        const index = waiters.indexOf(waiter);
        if (index >= 0) waiters.splice(index, 1);
        waiter.resolve(record);
      }
    })();
  });

  return {
    events: () => events.slice(),
    waitFor(event, predicate, timeoutMs = 30_000) {
      const matches = (item: RtcConsoleEvent) =>
        item.event === event && (predicate ? predicate(item) : true);
      const already = events.find(matches);
      if (already) return Promise.resolve(already);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const index = waiters.findIndex((waiter) => waiter.timer === timer);
          if (index >= 0) waiters.splice(index, 1);
          const late = events.find(matches);
          if (late) {
            resolve(late);
            return;
          }
          const seen = events.map((item) => summarizeRtcEvent(item)).join(", ");
          reject(new Error(`Timed out waiting for [rtc] ${event}. Seen: ${seen || "(none)"}`));
        }, timeoutMs);
        const waiter: Waiter = { matches, resolve, timer };
        waiters.push(waiter);
        const raced = events.find(matches);
        if (!raced) return;
        clearTimeout(timer);
        const index = waiters.indexOf(waiter);
        if (index >= 0) waiters.splice(index, 1);
        resolve(raced);
      });
    },
  };
}

/** `selectedPair.localType` of `selected-pair` events on one channel. */
export function selectedLocalTypes(events: readonly RtcConsoleEvent[], channel: string): string[] {
  const types: string[] = [];
  for (const item of events) {
    if (item.channel !== channel || item.event !== "selected-pair") continue;
    const pair = item.details?.selectedPair;
    if (!pair || typeof pair !== "object") continue;
    const localType = (pair as { localType?: unknown }).localType;
    if (typeof localType === "string" && localType !== "") types.push(localType);
  }
  return types;
}

/** Remote tile media clock moves. The 2s gap is the observation window. */
export async function remoteVideoAdvances(page: Page): Promise<void> {
  const currentTime = () =>
    page.evaluate(() => {
      const videos = Array.from(document.querySelectorAll("video.meet-peer-tile__stream"));
      const remote = videos.find((node) => {
        const tile = (node.closest(".meet-peer-tile")?.textContent ?? "")
          .replace(/\s+/g, " ")
          .trim();
        return !/^You\b/.test(tile);
      }) as HTMLVideoElement | undefined;
      return remote ? remote.currentTime : -1;
    });

  const before = await currentTime();
  expect(before).toBeGreaterThanOrEqual(0);
  await page.waitForTimeout(2_000);
  expect(await currentTime()).toBeGreaterThan(before);
}

export function postRelay(request: APIRequestContext, room: string, body: Record<string, unknown>) {
  return request.post(`${API}/api/v1/rooms/${encodeURIComponent(room)}/relay`, { data: body });
}
