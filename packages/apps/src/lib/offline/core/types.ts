import type { Transaction } from "dexie";

/** Generic key/value row used for cached bootstrap state and sync tokens. */
export type OfflineMetaRow = {
  key: string;
  value: string;
};

/**
 * Generic outbox row. `domain` namespaces rows per app (e.g. `contacts`), `op`
 * is a domain-defined verb, and `payload` is a JSON blob the domain interprets.
 */
export type OfflineOutboxRow = {
  id: string;
  domain: string;
  op: string;
  payload: string;
  ifInState?: string;
  createdAt: number;
  retries: number;
  lastError?: string;
  /** HTTP status from the last flush failure. Absent on rows written before this field. */
  lastStatus?: number;
};

/** Dexie store spec map (`tableName` → index spec). A `null` value drops the table. */
export type OfflineStoreSchema = Record<string, string | null>;

/** A single Dexie version step a domain contributes (within its allocated range; core owns version 1). */
export type OfflineDomainVersion = {
  version: number;
  /** Delta of stores added/changed at this version; merged onto the running schema. */
  stores: OfflineStoreSchema;
  /** Optional data migration run when upgrading into this version. */
  upgrade?: (tx: Transaction) => unknown | Promise<unknown>;
};

/** A domain plugin's table registration: one entry per Dexie version it adds. */
export type OfflineDomainRegistration = {
  domain: string;
  versions: OfflineDomainVersion[];
};

/**
 * Persistence contract a domain implements on top of the core Dexie database.
 * `TBootstrap` is the cached snapshot returned to the UI; `TEntity` is a single record.
 */
export type OfflineDomainStore<TBootstrap, TEntity> = {
  readBootstrap: (username: string) => Promise<TBootstrap | null>;
  writeBootstrap: (username: string, bootstrap: TBootstrap) => Promise<void>;
  upsertEntity: (username: string, entity: TEntity, pendingSync?: boolean) => Promise<void>;
  removeEntity: (username: string, entityId: string) => Promise<void>;
  readSyncToken: (username: string, scope: string) => Promise<string | null>;
  writeSyncToken: (username: string, scope: string, token: string) => Promise<void>;
};

/**
 * Factory shape consumed by a domain's `*-hybrid-operations`: given a username it
 * returns the read/write operations the UI calls, transparently routing online vs queued.
 */
export type OfflineDomainOperations<TOperations> = (username: string) => TOperations;
