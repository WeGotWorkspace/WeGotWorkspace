import Dexie, { type EntityTable, type Transaction } from "dexie";
import type {
  OfflineDomainRegistration,
  OfflineMetaRow,
  OfflineOutboxRow,
  OfflineStoreSchema,
} from "@/lib/offline/core/types";
import {
  claimOfflineDomainVersions,
  CORE_OFFLINE_VERSION,
  releaseOfflineDomainVersions,
} from "@/lib/offline/core/offline-version-allocation";

export { CORE_OFFLINE_VERSION } from "@/lib/offline/core/offline-version-allocation";

/** Generic, app-agnostic tables every account database always has. */
const CORE_STORES: OfflineStoreSchema = {
  meta: "key",
  outbox: "id, domain, createdAt",
};

const domainRegistrations = new Map<string, OfflineDomainRegistration>();

/**
 * Register a domain's Dexie tables/versions. Call this at module load (a side
 * effect import) before any database is opened. Re-registering the same domain
 * replaces its previous entry and invalidates cached databases so a fresh open
 * picks up the new schema (useful under HMR/tests).
 */
export function registerOfflineDomainTables(registration: OfflineDomainRegistration): void {
  releaseOfflineDomainVersions(registration.domain);
  claimOfflineDomainVersions(registration);
  domainRegistrations.set(registration.domain, registration);
  dbCache.clear();
}

type MergedVersionStep = {
  version: number;
  stores: OfflineStoreSchema;
  upgrades: NonNullable<OfflineDomainRegistration["versions"][number]["upgrade"]>[];
};

function collectVersionSteps(): MergedVersionStep[] {
  const byVersion = new Map<number, MergedVersionStep>();
  for (const registration of domainRegistrations.values()) {
    for (const version of registration.versions) {
      const step = byVersion.get(version.version) ?? {
        version: version.version,
        stores: {},
        upgrades: [],
      };
      step.stores = { ...step.stores, ...version.stores };
      if (version.upgrade) step.upgrades.push(version.upgrade);
      byVersion.set(version.version, step);
    }
  }
  return [...byVersion.values()].sort((a, b) => a.version - b.version);
}

function mergeSchema(base: OfflineStoreSchema, delta: OfflineStoreSchema): OfflineStoreSchema {
  const next: OfflineStoreSchema = { ...base };
  for (const [table, spec] of Object.entries(delta)) {
    if (spec === null) {
      delete next[table];
    } else {
      next[table] = spec;
    }
  }
  return next;
}

export class WgwOfflineDatabase extends Dexie {
  meta!: EntityTable<OfflineMetaRow, "key">;
  outbox!: EntityTable<OfflineOutboxRow, "id">;

  constructor(accountKey: string) {
    super(`wgw-offline-${accountKey}`);
    this.applyVersions();
  }

  private applyVersions(): void {
    let schema: OfflineStoreSchema = { ...CORE_STORES };
    this.version(CORE_OFFLINE_VERSION).stores(schema);

    for (const step of collectVersionSteps()) {
      schema = mergeSchema(schema, step.stores);
      const version = this.version(step.version).stores(schema);
      const upgrades = step.upgrades;
      if (upgrades.length > 0) {
        version.upgrade(async (tx: Transaction) => {
          for (const run of upgrades) {
            await run(tx);
          }
        });
      }
    }
  }
}

const dbCache = new Map<string, WgwOfflineDatabase>();

/** Close cached account databases and drop them so the next open is fresh. */
export function resetOfflineDatabaseCache(): void {
  for (const db of dbCache.values()) {
    db.close();
  }
  dbCache.clear();
}

export function offlineDbForAccount(accountKey: string): WgwOfflineDatabase {
  const cached = dbCache.get(accountKey);
  if (cached) return cached;
  const db = new WgwOfflineDatabase(accountKey);
  dbCache.set(accountKey, db);
  return db;
}

export function offlineAccountKeyFromUsername(username: string): string {
  return username.trim().toLowerCase() || "default";
}

/** Clears domain registrations and cached databases. For unit tests only. */
export function resetOfflineDomainRegistrationsForTests(): void {
  domainRegistrations.clear();
  resetOfflineDatabaseCache();
}
