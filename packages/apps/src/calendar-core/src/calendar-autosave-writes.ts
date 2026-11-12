import type { JmapCalendarEvent } from "@/lib/jmap-client";
import type { CalendarEventPatch } from "@/lib/models/calendar-types";

/** What a write sent, and the event it was built from (for Undo). */
export type CalendarSentPatch = { patch: CalendarEventPatch; base: JmapCalendarEvent | undefined };

/** Builds a write's patch from the event as the server has it (none when nothing changed). */
export type CalendarPatchBuilder = (
  base: JmapCalendarEvent | undefined,
) => CalendarEventPatch | null;
type SendPatch = (patch: CalendarEventPatch) => Promise<JmapCalendarEvent>;

export type CalendarAutosaveWrites = {
  /**
   * Waits for the autosaves before it, then builds its patch from the event as the server
   * returned it after the last one that went through (else `loaded`) and sends it.
   * Resolves with what was sent, or null when nothing changed.
   */
  run: (
    eventId: string,
    loaded: JmapCalendarEvent | undefined,
    build: CalendarPatchBuilder,
    send: SendPatch,
  ) => Promise<CalendarSentPatch | null>;
  /** Another event opened: start over from the loaded events. */
  reset: () => void;
};

async function sendBuilt(
  base: JmapCalendarEvent | undefined,
  build: CalendarPatchBuilder,
  send: SendPatch,
): Promise<{ sent: CalendarSentPatch; stored: JmapCalendarEvent } | null> {
  const patch = build(base);
  if (!patch || Object.keys(patch).length === 0) return null;
  return { sent: { patch, base }, stored: await send(patch) };
}

/**
 * The open event's autosaves, as Tasks does for a task: one write at a time, each built
 * when its turn comes against what the server has, so a slow write never wins over a
 * later one and a field typed back to its old value is still sent.
 */
export function createCalendarAutosaveWrites(): CalendarAutosaveWrites {
  const stored = new Map<string, JmapCalendarEvent>();
  let chain: Promise<unknown> = Promise.resolve();
  return {
    run: (eventId, loaded, build, send) => {
      const turn = chain.then(async () => {
        try {
          const result = await sendBuilt(stored.get(eventId) ?? loaded, build, send);
          if (result) stored.set(eventId, result.stored);
          return result?.sent ?? null;
        } catch (error) {
          // Unknown what the server has now: the next write builds on the loaded copy.
          stored.delete(eventId);
          throw error;
        }
      });
      chain = turn.catch(() => undefined);
      return turn;
    },
    reset: () => stored.clear(),
  };
}

/** One edit write: in turn with the autosaves when `writes` is given, else at once. */
export async function sendCalendarPatch(
  writes: CalendarAutosaveWrites | undefined,
  eventId: string,
  loaded: JmapCalendarEvent | undefined,
  build: CalendarPatchBuilder,
  send: SendPatch,
): Promise<CalendarSentPatch | null> {
  if (writes) return writes.run(eventId, loaded, build, send);
  return (await sendBuilt(loaded, build, send))?.sent ?? null;
}
