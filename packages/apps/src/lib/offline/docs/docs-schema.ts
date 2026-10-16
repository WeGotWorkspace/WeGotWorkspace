import type { EntityTable } from "dexie";
import {
  registerOfflineDomainTables,
  type WgwOfflineDatabase,
} from "@/lib/offline/core/offline-db";
import { DOCS_OFFLINE_VERSION } from "@/lib/offline/core/offline-version-allocation";

export const DOCS_DOMAIN = "docs";

/** Serialized unified-search row for the Docs home browse cache. */
export type OfflineDocsListingRow = {
  /** `${cacheKey}::${sourceKey}` */
  id: string;
  cacheKey: string;
  sourceKey: string;
  /** JSON payload mirroring `WgwUnifiedSearchResult` fields needed for listing. */
  data: string;
  modifiedAt: number;
  /** Stable ordering within a cache snapshot (0 = newest page-1 row). */
  sortIndex: number;
};

/**
 * User-pinned document available for offline open.
 * `id` stays the path. `nodeId` is optional until the first crawl.
 */
export type OfflineDocsAvailabilityRow = {
  /** Drive API path (normalized, no leading slash). */
  id: string;
  pinnedAt: number;
  lastSyncedAt: number | null;
  /** Display location from the home listing (e.g. "My Drive"). */
  location: string;
  /** JMAP FileNode id. Absent until a crawl has seen this path. */
  nodeId?: string;
};

/**
 * Docs Dexie tables, registered as additive versions on top of the core baseline:
 *
 * - **v20** introduces `docs_listing_rows` for offline home browse snapshots.
 * - **v21** introduces `docs_availability` for explicit offline pin registry.
 * - **v22** indexes optional `nodeId`. Rows without it stay valid.
 */
registerOfflineDomainTables({
  domain: DOCS_DOMAIN,
  versions: [
    {
      version: DOCS_OFFLINE_VERSION.listingTables,
      stores: {
        docs_listing_rows: "id, cacheKey, modifiedAt, sortIndex",
      },
    },
    {
      version: DOCS_OFFLINE_VERSION.availabilityTables,
      stores: {
        docs_availability: "id, pinnedAt, lastSyncedAt, location",
      },
    },
    {
      version: DOCS_OFFLINE_VERSION.availabilityNodeId,
      stores: {
        docs_availability: "id, pinnedAt, lastSyncedAt, location, nodeId",
      },
    },
  ],
});

export function docsListingRowsTable(
  db: WgwOfflineDatabase,
): EntityTable<OfflineDocsListingRow, "id"> {
  return db.table<OfflineDocsListingRow, string>("docs_listing_rows") as EntityTable<
    OfflineDocsListingRow,
    "id"
  >;
}

export function docsAvailabilityTable(
  db: WgwOfflineDatabase,
): EntityTable<OfflineDocsAvailabilityRow, "id"> {
  return db.table<OfflineDocsAvailabilityRow, string>("docs_availability") as EntityTable<
    OfflineDocsAvailabilityRow,
    "id"
  >;
}
