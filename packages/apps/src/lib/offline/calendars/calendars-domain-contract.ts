import type { CalendarAppBootstrap } from "@/lib/api/mock/calendar-bootstrap";
import type { JmapCalendarEvent } from "@/lib/jmap-client";
import type { CalendarAPIOperations } from "@/calendar-core/src/calendar-types";
import { createHybridCalendarOperations } from "@/lib/offline/calendars-hybrid-operations";
import {
  readCalendarBootstrapFromCache,
  readCalendarSyncToken,
  removeCalendarEventFromCache,
  upsertCalendarEventInCache,
  writeCalendarBootstrapToCache,
  writeCalendarSyncToken,
} from "@/lib/offline/calendars-offline-store";
import type { OfflineDomainOperations, OfflineDomainStore } from "@/lib/offline/core/types";

/**
 * Calendars persistence wired to {@link OfflineDomainStore} — the sixth domain
 * on the shared Dexie core. Domain-specific helpers (outbox coalescing, temp
 * ids) stay on `calendars-offline-store.ts`.
 */
export const calendarsOfflineDomainStore = {
  readBootstrap: readCalendarBootstrapFromCache,
  writeBootstrap: writeCalendarBootstrapToCache,
  upsertEntity: upsertCalendarEventInCache,
  removeEntity: removeCalendarEventFromCache,
  readSyncToken: readCalendarSyncToken,
  writeSyncToken: writeCalendarSyncToken,
} satisfies OfflineDomainStore<CalendarAppBootstrap, JmapCalendarEvent>;

/** Calendars hybrid API factory wired to {@link OfflineDomainOperations}. */
export const calendarsHybridDomainOperations: OfflineDomainOperations<CalendarAPIOperations> =
  createHybridCalendarOperations;
