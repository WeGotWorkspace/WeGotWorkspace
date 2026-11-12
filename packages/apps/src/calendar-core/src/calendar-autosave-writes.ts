import type { JmapCalendarEvent } from "@/lib/jmap-client";
import { pageIsExiting } from "@/lib/page-exit";

export type CalendarAutosaveWrites = {
  /** The event as the last autosave wrote it, else `loaded` (which may not have refetched). */
  base: (eventId: string, loaded: JmapCalendarEvent | undefined) => JmapCalendarEvent | undefined;
  /**
   * Runs `write` after the autosaves before it, so they land in order, and remembers
   * `base` with `patch` as the event's new written state.
   */
  run: (
    eventId: string,
    base: JmapCalendarEvent | undefined,
    patch: object,
    write: () => Promise<unknown>,
  ) => Promise<void>;
  /** Another event opened: start over from the loaded events. */
  reset: () => void;
};

/**
 * The open event's autosaves, as Tasks does for a task: one write at a time, each diffed
 * against what the last one wrote. A write on page exit goes at once (nothing waits then).
 */
export function createCalendarAutosaveWrites(): CalendarAutosaveWrites {
  const written = new Map<string, JmapCalendarEvent>();
  let chain: Promise<unknown> = Promise.resolve();
  return {
    base: (eventId, loaded) => written.get(eventId) ?? loaded,
    run: (eventId, base, patch, write) => {
      if (base) written.set(eventId, { ...base, ...patch } as JmapCalendarEvent);
      const run = (pageIsExiting() ? write() : chain.then(write)).then(
        () => undefined,
        (error: unknown) => {
          // Unknown what the server has now: diff the next write against the loaded copy.
          written.delete(eventId);
          throw error;
        },
      );
      chain = run.catch(() => undefined);
      return run;
    },
    reset: () => written.clear(),
  };
}
