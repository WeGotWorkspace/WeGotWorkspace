import type { OfflineDomainRegistration } from "@/lib/offline/core/types";

/** Core Dexie version. Domains contribute additive versions starting at 2. */
export const CORE_OFFLINE_VERSION = 1;

/** Inclusive Dexie version range reserved for one offline domain plugin. */
export type OfflineDomainVersionRange = {
  min: number;
  max: number;
};

/**
 * Fixed, non-overlapping version blocks per domain. Reserve a block here before
 * registering tables for a new offline app (see offline-platform.md).
 */
export const OFFLINE_DOMAIN_VERSION_RANGES: Record<string, OfflineDomainVersionRange> = {
  contacts: { min: 2, max: 9 },
  notes: { min: 10, max: 19 },
  docs: { min: 20, max: 29 },
  drive: { min: 30, max: 39 },
  tasks: { min: 40, max: 49 },
  calendars: { min: 50, max: 59 },
};

/** Contacts version steps within the contacts block (2–9). */
export const CONTACTS_OFFLINE_VERSION = {
  tables: 2,
  updatedAtIndex: 3,
} as const;

/** Notes version steps within the notes block (10–19). */
export const NOTES_OFFLINE_VERSION = {
  tables: 10,
  updatedAtIndex: 11,
} as const;

/** Docs version steps within the docs block (20–29). */
export const DOCS_OFFLINE_VERSION = {
  listingTables: 20,
  availabilityTables: 21,
} as const;

/** Drive version steps within the drive block (30–39). */
export const DRIVE_OFFLINE_VERSION = {
  entriesTables: 30,
  contentTables: 31,
  availabilityTables: 32,
} as const;

/** Tasks version steps within the tasks block (40–49). */
export const TASKS_OFFLINE_VERSION = {
  tables: 40,
  updatedAtIndex: 41,
} as const;

/** Calendars version steps within the calendars block (50–59). */
export const CALENDARS_OFFLINE_VERSION = {
  tables: 50,
  groups: 51,
  scheduling: 52,
} as const;

const versionOwners = new Map<number, string>();

function assertNonOverlappingRanges(ranges: Record<string, OfflineDomainVersionRange>): void {
  const entries = Object.entries(ranges);
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const [domainA, rangeA] = entries[i]!;
      const [domainB, rangeB] = entries[j]!;
      if (rangeA.min <= rangeB.max && rangeB.min <= rangeA.max) {
        throw new Error(
          `Offline version ranges for "${domainA}" (${rangeA.min}–${rangeA.max}) and "${domainB}" (${rangeB.min}–${rangeB.max}) overlap.`,
        );
      }
    }
  }
}

assertNonOverlappingRanges(OFFLINE_DOMAIN_VERSION_RANGES);

export function releaseOfflineDomainVersions(domain: string): void {
  for (const [version, owner] of versionOwners) {
    if (owner === domain) versionOwners.delete(version);
  }
}

/**
 * Validates a domain registration against its allocated range and claims each
 * version number. Throws when a version is out of range or already owned by
 * another domain.
 */
export function claimOfflineDomainVersions(registration: OfflineDomainRegistration): void {
  const range = OFFLINE_DOMAIN_VERSION_RANGES[registration.domain];
  if (!range) {
    throw new Error(
      `Offline domain "${registration.domain}" has no allocated Dexie version range. Add an entry to OFFLINE_DOMAIN_VERSION_RANGES before registering tables.`,
    );
  }

  const seen = new Set<number>();
  for (const step of registration.versions) {
    if (seen.has(step.version)) {
      throw new Error(
        `Offline domain "${registration.domain}" declares Dexie version ${step.version} more than once.`,
      );
    }
    seen.add(step.version);

    if (step.version < range.min || step.version > range.max) {
      throw new Error(
        `Offline domain "${registration.domain}" cannot use Dexie version ${step.version}; allocated range is ${range.min}–${range.max}.`,
      );
    }

    const existing = versionOwners.get(step.version);
    if (existing !== undefined && existing !== registration.domain) {
      throw new Error(
        `Dexie version ${step.version} is already claimed by domain "${existing}"; domain "${registration.domain}" cannot reuse it.`,
      );
    }
    versionOwners.set(step.version, registration.domain);
  }
}

/** Clears version ownership claims. For unit tests only. */
export function resetOfflineVersionClaimsForTests(): void {
  versionOwners.clear();
}

/** Seeds a version owner without range validation. For unit tests only. */
export function seedOfflineVersionOwnerForTests(version: number, domain: string): void {
  versionOwners.set(version, domain);
}
