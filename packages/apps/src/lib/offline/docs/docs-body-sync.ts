import type { WgwUnifiedSearchParams, WgwUnifiedSearchResult } from "@/lib/api/wgw/search";
import { fetchWgwUnifiedSearch } from "@/lib/api/wgw/search";
import {
  DOCS_HOME_CATEGORIES,
  DOCS_HOME_EXTENSIONS,
  DOCS_HOME_PAGE_SIZE,
  DOCS_HOME_SOURCES,
} from "@/docs-core/src/docs-home-constants";
import {
  fetchAllDocsHomeListingPages,
  sortDocsHomeResults,
  type DocsHomeFetcher,
} from "@/docs-core/src/use-docs-home-list";
import { backgroundSyncPacer } from "@/lib/offline/core/background-sync-pacer";
import { getConnectivitySnapshot } from "@/lib/offline/core/browser-online";
import {
  isEligibleForAutoContentSync,
  readOfflineDeviceContentSettings,
} from "@/lib/offline/core/offline-device-settings";
import {
  emptyProgressiveSyncProgress,
  readProgressiveSyncProgress,
  runProgressiveSync,
  type ProgressiveSyncProgress,
} from "@/lib/offline/core/progressive-sync-runner";
import { makeDocsOfflineAvailable } from "@/lib/offline/docs/docs-offline-pin-core";

const DOCS_BODY_SYNC_META_KEY = "docs:auto-sync:body-progress";
/** Low on purpose: the pacer sets the rate; this keeps browser connections free for the user. */
const DOCS_BODY_SYNC_CONCURRENCY = 2;

export type DocsBodySyncProgress = ProgressiveSyncProgress;

function emptyProgress(): DocsBodySyncProgress {
  return emptyProgressiveSyncProgress();
}

function normalizeSourceKey(sourceKey: string): string {
  return sourceKey.trim().replace(/^\/+/, "");
}

function sourceExt(sourceKey: string): string {
  const file = normalizeSourceKey(sourceKey).split("/").pop() ?? "";
  const dot = file.lastIndexOf(".");
  return dot >= 0 ? file.slice(dot + 1).toLowerCase() : "";
}

function isSupportedHomeDoc(sourceKey: string, username: string): boolean {
  const normalized = normalizeSourceKey(sourceKey);
  if (!normalized) return false;
  if (
    !DOCS_HOME_EXTENSIONS.includes(sourceExt(normalized) as (typeof DOCS_HOME_EXTENSIONS)[number])
  ) {
    return false;
  }
  if (normalized.startsWith(`users/${username}/`)) return true;
  return normalized.startsWith("groups/");
}

function fileLocationFromSourceKey(sourceKey: string, username: string): string {
  const normalized = normalizeSourceKey(sourceKey);
  if (normalized.startsWith(`users/${username}/`)) return "My Drive";
  if (normalized.startsWith("groups/")) {
    const group = normalized.split("/")[1] ?? "Group";
    return `Group: ${group}`;
  }
  return "Documents";
}

export async function readDocsBodySyncProgress(username: string): Promise<DocsBodySyncProgress> {
  return readProgressiveSyncProgress(username, DOCS_BODY_SYNC_META_KEY);
}

export async function syncDocsBodiesFromListingResults(
  username: string,
  results: readonly WgwUnifiedSearchResult[],
  options?: { signal?: AbortSignal },
): Promise<DocsBodySyncProgress> {
  if (!username || !getConnectivitySnapshot()) return emptyProgress();
  const settings = readOfflineDeviceContentSettings();
  if (!settings.contentSyncEnabled) return emptyProgress();

  const signal = options?.signal;
  const newestFirst = sortDocsHomeResults(results);
  const queue = newestFirst.filter(
    (row) =>
      isSupportedHomeDoc(row.sourceKey, username) &&
      isEligibleForAutoContentSync(row.size, settings),
  );

  const pacer = backgroundSyncPacer();
  return runProgressiveSync({
    username,
    metaKey: DOCS_BODY_SYNC_META_KEY,
    items: queue,
    concurrency: DOCS_BODY_SYNC_CONCURRENCY,
    signal,
    pacer,
    syncOne: async (row) => {
      const apiPath = `/${normalizeSourceKey(row.sourceKey)}`;
      await makeDocsOfflineAvailable(
        username,
        apiPath,
        fileLocationFromSourceKey(row.sourceKey, username),
        {
          beforeRequest: () => pacer.acquire(signal),
          // Drive sync usually got here first; an unchanged document costs no request.
          modifiedAtMs: (row.modifiedAt ?? 0) * 1000,
        },
      );
    },
  });
}

export async function syncDocsBodiesFromHomeListing(
  username: string,
  options?: {
    fetcher?: DocsHomeFetcher;
    signal?: AbortSignal;
  },
): Promise<DocsBodySyncProgress> {
  if (!username || !getConnectivitySnapshot()) return emptyProgress();
  const fetcher = options?.fetcher ?? fetchWgwUnifiedSearch;
  const signal = options?.signal;
  const params: Omit<WgwUnifiedSearchParams, "signal" | "q" | "offset"> & { limit: number } = {
    sources: [...DOCS_HOME_SOURCES],
    extensions: [...DOCS_HOME_EXTENSIONS],
    categories: [...DOCS_HOME_CATEGORIES],
    limit: DOCS_HOME_PAGE_SIZE,
  };

  const { results } = await fetchAllDocsHomeListingPages(
    fetcher,
    params,
    "",
    signal ?? new AbortController().signal,
  );
  return syncDocsBodiesFromListingResults(username, results, { signal });
}
