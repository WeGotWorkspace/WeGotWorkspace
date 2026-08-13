import { createContext } from "@lit/context";
import type { CalendarViewContextValue } from "../types/CalendarViewContext.js";

export type { CalendarViewContextValue };

export const calendarViewContext = createContext<CalendarViewContextValue>(
  Symbol("calendar-grid-view-context"),
);
