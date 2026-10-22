import { readBrowserOnline } from "@/lib/offline/core/browser-online";
import { withCrossTabLock } from "@/lib/offline/core/cross-tab-lock";
import {
  isRetryableOutboxRow,
  listOutboxMutationsForDomain,
} from "@/lib/offline/core/outbox-store";

/** Waits before trying again after a busy or failing server; then a person retries. */
const RETRY_DELAYS_MS = [5_000, 15_000, 60_000, 300_000];

type FlushTask<T> = () => Promise<T>;

/**
 * The outbox of one domain for one account lives in one IndexedDB shared by
 * all tabs. Every flush of it runs under this lock, so two tabs coming back
 * online never send the same queued write twice.
 */
export function withOutboxLock<T>(
  domain: string,
  username: string,
  task: () => Promise<T>,
): Promise<T> {
  return withCrossTabLock(`wgw-outbox:${domain}:${username}`, task);
}

/** Serializes flush attempts so a single in-flight sync never overlaps itself. */
export class ConnectivitySyncRunner<T = void> {
  private inFlight: Promise<T | undefined> | undefined;

  constructor(private readonly flushTask: FlushTask<T>) {}

  flush(): Promise<T | undefined> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.flushTask()
      .catch(() => undefined)
      .finally(() => {
        this.inFlight = undefined;
      });
    return this.inFlight;
  }
}

/**
 * Per-account registry of {@link ConnectivitySyncRunner} instances for one
 * domain. In-tab, a runner single-flights; across tabs, the outbox lock does.
 *
 * A row that failed for a passing reason (429, 5xx) is tried again by itself:
 * online, nothing else would start the next flush. Conflicts, 403 and 404 wait
 * for a person.
 */
export class ConnectivitySyncRunnerRegistry<T = void> {
  private readonly runners = new Map<string, ConnectivitySyncRunner<T>>();

  constructor(private readonly domain: string) {}

  getOrCreate(username: string, flushTask: FlushTask<T>): ConnectivitySyncRunner<T> {
    const existing = this.runners.get(username);
    if (existing) return existing;
    // The ladder counts only flushes its own timer started; any other flush
    // (Retry, reconnect, a new write) starts it again from the first step.
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let timerFired = false;
    const retryIfStillFailing = async (startedByTimer: boolean) => {
      clearTimeout(retryTimer);
      if (!startedByTimer) attempt = 0;
      const rows = await listOutboxMutationsForDomain(username, this.domain);
      if (!rows.some(isRetryableOutboxRow)) {
        attempt = 0;
        return;
      }
      const delay = RETRY_DELAYS_MS[attempt];
      if (delay === undefined || !readBrowserOnline()) return;
      attempt += 1;
      retryTimer = setTimeout(() => {
        timerFired = true;
        void runner.flush();
      }, delay);
    };
    const runner: ConnectivitySyncRunner<T> = new ConnectivitySyncRunner(() => {
      const startedByTimer = timerFired;
      timerFired = false;
      return withOutboxLock(this.domain, username, flushTask).finally(() =>
        retryIfStillFailing(startedByTimer),
      );
    });
    this.runners.set(username, runner);
    return runner;
  }
}
