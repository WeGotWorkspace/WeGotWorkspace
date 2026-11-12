import { patchToJmapPartial } from "@/calendar-core/src/calendar-wire";
import type { JmapCalendarEvent } from "@/lib/jmap-client";
import type { CalendarEventPatch } from "@/lib/models/calendar-types";
import { pageIsExiting } from "@/lib/page-exit";

export type CalendarAutosaveWrites = {
  /** The event as the queued autosaves will leave it, else `loaded` (which may not have refetched). */
  base: (eventId: string, loaded: JmapCalendarEvent | undefined) => JmapCalendarEvent | undefined;
  /**
   * Runs an autosave after the ones before it, so they land in order. `build` makes the patch
   * when its turn comes, against the last event that was written (else `loaded`), and returns
   * null when nothing is left to send.
   */
  run: <P extends CalendarEventPatch | object>(
    eventId: string,
    loaded: JmapCalendarEvent | undefined,
    build: (base: JmapCalendarEvent | undefined) => P | null,
    write: (patch: P) => Promise<unknown>,
  ) => Promise<void>;
  /** Another event opened: start over from the loaded events. */
  reset: () => void;
};

/**
 * The open event's autosaves, as Tasks does for a task: one write at a time, each diffed
 * against what the last one wrote. A write on page exit goes at once (nothing waits then).
 */
export function createCalendarAutosaveWrites(): CalendarAutosaveWrites {
  // What the server holds after the writes that succeeded.
  const confirmed = new Map<string, JmapCalendarEvent>();
  // What it will hold once the queued writes land: the base for deciding whether to save.
  const queued = new Map<string, JmapCalendarEvent>();
  let pending = 0;
  let chain: Promise<unknown> = Promise.resolve();

  const apply = (base: JmapCalendarEvent | undefined, patch: object) =>
    base
      ? ({ ...base, ...patchToJmapPartial(patch as CalendarEventPatch) } as JmapCalendarEvent)
      : undefined;

  return {
    base: (eventId, loaded) => queued.get(eventId) ?? confirmed.get(eventId) ?? loaded,
    run: (eventId, loaded, build, write) => {
      const step = async () => {
        const base = confirmed.get(eventId) ?? loaded;
        const patch = build(base);
        if (!patch) return;
        await write(patch);
        const next = apply(base, patch);
        if (next) confirmed.set(eventId, next);
      };
      // Note the patch as queued as soon as it is known, before its turn.
      const queuedBase = queued.get(eventId) ?? confirmed.get(eventId) ?? loaded;
      const early = build(queuedBase);
      const queuedNext = early ? apply(queuedBase, early) : undefined;
      if (queuedNext) queued.set(eventId, queuedNext);
      pending += 1;
      const run = (pageIsExiting() ? step() : chain.then(step)).then(
        () => {
          pending -= 1;
        },
        (error: unknown) => {
          pending -= 1;
          // Unknown what the server has now: diff the next write against what succeeded.
          if (pending === 0) queued.delete(eventId);
          throw error;
        },
      );
      chain = run.catch(() => undefined);
      return run;
    },
    reset: () => {
      confirmed.clear();
      queued.clear();
    },
  };
}
