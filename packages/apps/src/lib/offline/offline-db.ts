/**
 * @deprecated Generic database helpers now live in `@/lib/offline/core/offline-db`
 * and domain table types under `@/lib/offline/contacts/` and `@/lib/offline/notes/`.
 * This shim preserves the historical import path and guarantees domain schemas are
 * registered before the database opens.
 */
import "@/lib/offline/calendars/calendars-schema";
import "@/lib/offline/contacts/contacts-schema";
import "@/lib/offline/docs/docs-schema";
import "@/lib/offline/drive/drive-schema";
import "@/lib/offline/notes/notes-schema";
import "@/lib/offline/tasks/tasks-schema";

export {
  CORE_OFFLINE_VERSION,
  WgwOfflineDatabase,
  offlineAccountKeyFromUsername,
  offlineDbForAccount,
  registerOfflineDomainTables,
} from "@/lib/offline/core/offline-db";
export type { OfflineMetaRow, OfflineOutboxRow } from "@/lib/offline/core/types";
export type {
  OfflineAddressBookRow,
  OfflineContactCardRow,
} from "@/lib/offline/contacts/contacts-schema";
