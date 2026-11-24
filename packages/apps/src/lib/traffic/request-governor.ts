/**
 * Browser-wide traffic governor for the suite's own API (shared hosting
 * traffic budget, #2291). It runs in the service worker, the one place every
 * tab's requests pass through, and only looks at same-origin `/api/v1/…`:
 *
 * - **Coalesce:** `settings/state`, `me` and `jmap/session` reads of one
 *   signed-in session share one request and one answer for a short while,
 *   however many apps and tabs ask at start-up.
 * - **Background:** polls (signaling, the push stream, `…/changes`,
 *   notification lists, or anything marked `X-WGW-Traffic: background`) draw
 *   from a token bucket. With an empty bucket the request waits (never longer
 *   than `maxWaitMs`), so the whole browser slows down to the budget.
 * - **Bulk:** first downloads and prefetch marked `X-WGW-Traffic: bulk` go one
 *   at a time at their own pace, never in a burst.
 * - **Shared brake:** a network failure, 429 or 503 holds background and bulk
 *   requests (2 s doubling to 60 s, or the server's `Retry-After`).
 * - **Everything else** (foreground reads, writes) is never delayed. It is only
 *   counted against the bucket, so background work yields to it.
 *
 * The numbers come from the server (`X-WGW-Traffic-Budget`, one client build
 * serves every install channel). Until the first answer carrying the header the
 * strict shared-hosting defaults hold, and 0 turns pacing off.
 *
 * This is politeness toward the host's per-IP firewall, not a security
 * boundary: a page can only ever get *slower* by marking its own requests,
 * because unmarked requests are the fast path. See the PR for what the
 * header trusts.
 */

export type GovernorClass = "coalesce" | "background" | "bulk" | "foreground" | "write";

/**
 * A client marks work nobody waits for with this header: `bulk` for first
 * downloads and offline prefetch, `background` for polls the path rules miss.
 * It is the only way a write-shaped request (a JMAP read is a POST) is
 * governed; unmarked writes always go straight through. Mark only work that
 * does not depend on its order against other writes: a marked request can
 * wait behind the budget while an unmarked one passes.
 */
export const TRAFFIC_CLASS_HEADER = "X-WGW-Traffic";

const COALESCE_PATHS = [/\/settings\/state$/, /\/me$/, /\/jmap\/session$/];

const BACKGROUND_PATHS = [
  /\/rooms\/[^/]+\/events$/,
  /\/jmap\/events\//,
  /\/changes$/,
  /\/notifications$/,
];

/** `null` for anything that is not the suite's own API: the governor never touches it. */
export function classifyRequest(
  method: string,
  url: URL,
  apiPrefix = "/api/v1",
  marker: string | null = null,
): GovernorClass | null {
  if (!url.pathname.startsWith(`${apiPrefix}/`)) return null;
  const mark = marker?.trim().toLowerCase();
  if (mark === "bulk" || mark === "background") return mark;
  const verb = method.toUpperCase();
  if (verb !== "GET" && verb !== "HEAD") return "write";
  if (verb === "HEAD") return "foreground";
  const path = url.pathname;
  if (COALESCE_PATHS.some((pattern) => pattern.test(path))) return "coalesce";
  if (BACKGROUND_PATHS.some((pattern) => pattern.test(path))) return "background";
  return "foreground";
}

/** The classes the worker answers itself; the rest only count and go on natively. */
export function isGovernedClass(kind: GovernorClass): boolean {
  return kind === "coalesce" || kind === "background" || kind === "bulk";
}

export type GovernorOptions = {
  /** Sustained background requests per minute for the whole browser. 0 = unpaced. */
  backgroundPerMinute: number;
  /** Background requests that may go at once after a quiet spell. */
  burst: number;
  /** How long a coalesced answer is reused. */
  coalesceTtlMs: number;
  /** Sustained bulk requests per minute (first downloads, offline prefetch). 0 = unpaced. */
  bulkPerMinute: number;
  /** A background request never waits longer than this for a token or the brake. */
  maxWaitMs: number;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  fetch: (request: Request) => Promise<Response>;
};

/** Strict shared-hosting numbers: they hold until the server announces others. */
export const DEFAULT_GOVERNOR_OPTIONS: Omit<GovernorOptions, "now" | "sleep" | "fetch"> = {
  backgroundPerMinute: 30,
  burst: 10,
  bulkPerMinute: 20,
  coalesceTtlMs: 15_000,
  maxWaitMs: 30_000,
};

/** Response header with the server's budget (`App\\Support\\TrafficBudget`). */
export const TRAFFIC_BUDGET_HEADER = "X-WGW-Traffic-Budget";

export type TrafficBudget = { background: number; bulk: number; burst: number };

/** The server clamps to the same range; the client does not trust that. */
const BUDGET_MAX = 10_000;

/**
 * `background=30; bulk=20; burst=10` → numbers, each clamped to 0–10000.
 * `null` when the header is missing or malformed (the budget then stays as it was).
 */
export function parseTrafficBudget(header: string | null): TrafficBudget | null {
  if (!header) return null;
  const values: Record<string, number> = {};
  for (const part of header.split(";")) {
    const [key, raw] = part.split("=").map((item) => item.trim());
    if (!key || raw === undefined || !/^\d{1,9}$/.test(raw)) continue;
    values[key] = Math.min(BUDGET_MAX, Number(raw));
  }
  const { background, bulk, burst } = values;
  if (background === undefined || bulk === undefined || burst === undefined) return null;
  return { background, bulk, burst };
}

const BRAKE_FIRST_MS = 2_000;
const BRAKE_MAX_MS = 60_000;
/** `Retry-After` beyond this is capped (spec: 5 minutes). */
const RETRY_AFTER_MAX_MS = 5 * 60_000;
/** Answers kept for reuse at most; a signed-in browser has a handful of keys. */
const COALESCE_MAX_ENTRIES = 32;

type Cached = { at: number; response: Promise<Response> };

export class RequestGovernor {
  private tokens: number;
  private refilledAt: number;
  private brakeUntil = 0;
  private brakeMs = 0;
  private readonly coalesced = new Map<string, Cached>();
  private queue: Promise<void> = Promise.resolve();
  private bulkQueue: Promise<void> = Promise.resolve();
  private bulkNextAt = 0;

  constructor(private readonly options: GovernorOptions) {
    this.tokens = options.burst;
    this.refilledAt = options.now();
  }

  /** Applies the server's budget. 0 per minute turns pacing off for that class. */
  configure(budget: TrafficBudget): void {
    this.refill();
    this.options.backgroundPerMinute = budget.background;
    this.options.bulkPerMinute = budget.bulk;
    // A bucket that holds less than one token would never release a request.
    this.options.burst = Math.max(1, budget.burst);
    this.tokens = Math.min(this.tokens, this.options.burst);
  }

  /**
   * A request the worker lets through untouched (a foreground read, a write):
   * it uses a token, so polls yield to it, but it never waits. A write also
   * drops every shared answer, so a read after it sees the change.
   */
  observe(kind: "foreground" | "write"): void {
    if (kind === "write") this.coalesced.clear();
    if (this.options.backgroundPerMinute > 0) this.charge();
  }

  async handle(request: Request, kind: GovernorClass): Promise<Response> {
    if (kind === "coalesce") return this.coalesce(request);
    if (kind === "background" && this.options.backgroundPerMinute > 0) {
      await this.waitForTurn();
    } else if (kind === "bulk" && this.options.bulkPerMinute > 0) {
      await this.waitForBulkTurn();
    } else if (kind === "foreground" || kind === "write") {
      this.observe(kind);
    }
    return this.send(request);
  }

  /** Bulk requests go one after another at their own pace, never in a burst, and honour the brake. */
  private waitForBulkTurn(): Promise<void> {
    const turn = this.bulkQueue.then(async () => {
      for (;;) {
        const wait = Math.max(this.bulkNextAt, this.brakeUntil) - this.options.now();
        if (wait <= 0) break;
        await this.options.sleep(wait);
      }
      this.bulkNextAt = this.options.now() + Math.ceil(60_000 / this.options.bulkPerMinute);
    });
    this.bulkQueue = turn.catch(() => undefined);
    return turn;
  }

  /**
   * One request and one answer per session and URL for `coalesceTtlMs`. The key
   * holds a hash of the `Authorization` header, so a second user of the same
   * browser never gets the first one's answer; a request without it (cookie or
   * no session) is never shared.
   */
  private async coalesce(request: Request): Promise<Response> {
    const authorization = request.headers.get("Authorization");
    const forced = request.cache === "reload" || request.cache === "no-store";
    if (!authorization || forced) {
      this.observe("foreground");
      return this.send(request);
    }
    const key = `${request.url}\n${await digest(authorization)}`;
    const now = this.options.now();
    this.prune(now);
    const hit = this.coalesced.get(key);
    if (hit) return (await hit.response).clone();
    // The answer outlives its first caller: a page that aborts its read must not
    // fail the others waiting on it, so the shared request carries no signal.
    const shared = new Request(request.url, {
      method: "GET",
      headers: request.headers,
      credentials: request.credentials,
      mode: request.mode === "navigate" ? "same-origin" : request.mode,
      redirect: request.redirect,
    });
    this.observe("foreground");
    const response = this.send(shared).then((answer) => {
      // Only a good answer is shared; anything else is retried by the next caller.
      if (!answer.ok) this.coalesced.delete(key);
      return answer;
    });
    this.coalesced.set(key, { at: now, response });
    response.catch(() => this.coalesced.delete(key));
    return (await response).clone();
  }

  private prune(now: number): void {
    for (const [key, entry] of this.coalesced) {
      if (now - entry.at >= this.options.coalesceTtlMs) this.coalesced.delete(key);
    }
    while (this.coalesced.size >= COALESCE_MAX_ENTRIES) {
      const oldest = this.coalesced.keys().next().value;
      if (oldest === undefined) break;
      this.coalesced.delete(oldest);
    }
  }

  /**
   * Background requests take turns, first come first served: one token each,
   * after any brake. A request that has waited `maxWaitMs` goes anyway, so
   * under a long brake the browser still lets one probe through per
   * `maxWaitMs` instead of freezing its polls.
   */
  private waitForTurn(): Promise<void> {
    const turn = this.queue.then(async () => {
      const started = this.options.now();
      for (;;) {
        const now = this.options.now();
        const remaining = this.options.maxWaitMs - (now - started);
        if (remaining <= 0) break;
        const braked = this.brakeUntil - now;
        if (braked > 0) {
          await this.options.sleep(Math.min(braked, remaining));
          continue;
        }
        this.refill();
        if (this.tokens >= 1) break;
        const perMs = this.options.backgroundPerMinute / 60_000;
        await this.options.sleep(Math.min(Math.ceil((1 - this.tokens) / perMs), remaining));
      }
      this.charge();
    });
    this.queue = turn.catch(() => undefined);
    return turn;
  }

  private refill(): void {
    const now = this.options.now();
    const perMs = this.options.backgroundPerMinute / 60_000;
    this.tokens = Math.min(
      this.options.burst,
      this.tokens + Math.max(0, now - this.refilledAt) * perMs,
    );
    this.refilledAt = now;
  }

  /** Spends a token. The bucket may go into debt (down to one burst) when others pay at once. */
  private charge(): void {
    this.refill();
    this.tokens = Math.max(-this.options.burst, this.tokens - 1);
  }

  private async send(request: Request): Promise<Response> {
    try {
      const response = await this.options.fetch(request);
      // Only an answer from this origin may change the budget.
      if (response.type !== "opaque" && response.type !== "cors") {
        const budget = parseTrafficBudget(response.headers.get(TRAFFIC_BUDGET_HEADER));
        if (budget) this.configure(budget);
      }
      if (response.status === 429 || response.status === 503) {
        this.brake(this.retryAfterMs(response));
      } else {
        this.brakeMs = 0;
      }
      return response;
    } catch (error) {
      this.brake(null);
      throw error;
    }
  }

  private brake(serverMs: number | null): void {
    this.brakeMs = this.brakeMs === 0 ? BRAKE_FIRST_MS : Math.min(BRAKE_MAX_MS, this.brakeMs * 2);
    const wait = serverMs ?? this.brakeMs;
    this.brakeUntil = Math.max(this.brakeUntil, this.options.now() + wait);
  }

  private retryAfterMs(response: Response): number | null {
    const header = response.headers.get("Retry-After")?.trim();
    if (!header) return null;
    if (/^\d+$/.test(header)) return Math.min(RETRY_AFTER_MAX_MS, Number(header) * 1000);
    const date = Date.parse(header);
    return Number.isFinite(date)
      ? Math.min(RETRY_AFTER_MAX_MS, Math.max(0, date - this.options.now()))
      : null;
  }
}

async function digest(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
