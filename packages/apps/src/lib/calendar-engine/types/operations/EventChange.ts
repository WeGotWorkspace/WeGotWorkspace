import type { CalendarEvent } from "../event/index.js";
import type { EventKey } from "./primitives.js";

export type EventChange =
  | { type: "created"; key: EventKey; event: CalendarEvent }
  | { type: "updated"; key: EventKey; before: CalendarEvent; after: CalendarEvent }
  | { type: "removed"; key: EventKey; before: CalendarEvent };
