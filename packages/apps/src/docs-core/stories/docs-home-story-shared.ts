import type { WgwUnifiedSearchData, WgwUnifiedSearchResult } from "@/lib/api/wgw/search";
import type { WorkspaceSession } from "@/lib/workspace/workspace-session";
import type { DriveAPIOperations, DriveUIData } from "@/drive-core/src/drive-types";
import { mapDocsHomeResults, type DocsHomeFetcher } from "@/docs-core/src/use-docs-home-list";

export const docsHomeStorySession: WorkspaceSession = {
  user: {
    displayName: "Alice Rivera",
    username: "alice",
    email: "alice@example.com",
  },
  viewerInboxLabel: "me",
};

const DAY = 24 * 60 * 60;
const NOW = 1_750_000_000;

function fixture(
  id: number,
  sourceKey: string,
  title: string,
  ageDays: number,
  options?: { hasShares?: boolean; hasPublicShare?: boolean; hasTeamShare?: boolean },
): WgwUnifiedSearchResult {
  const extension = sourceKey.split(".").pop() ?? "md";
  return {
    id,
    sourceType: "file",
    sourceKey,
    title,
    extension,
    category: "document",
    contentType: extension === "txt" ? "text/plain" : "text/markdown",
    size: 1024 + id * 37,
    modifiedAt: NOW - ageDays * DAY,
    snippet: `Preview of ${title}…`,
    metadata: {
      path: `/${sourceKey}`,
      ...(options?.hasShares ? { hasShares: true } : {}),
      ...(options?.hasPublicShare ? { hasPublicShare: true, hasShares: true } : {}),
      ...(options?.hasTeamShare ? { hasTeamShare: true, hasShares: true } : {}),
    },
  };
}

/** Mixed My Drive + Groups fixtures, newest first. */
export const DOCS_HOME_STORY_FIXTURES: WgwUnifiedSearchResult[] = [
  fixture(1, "users/alice/Roadmap 2026.md", "Roadmap 2026", 0, { hasPublicShare: true }),
  fixture(2, "groups/engineering/RFC Storage Tiers.md", "RFC: Storage Tiers", 1),
  fixture(3, "users/alice/Notes/Standup.txt", "Standup", 2),
  fixture(4, "groups/design/Brand Voice.markdown", "Brand Voice", 4),
  fixture(5, "users/alice/Personal Journal.md", "Personal Journal", 6),
  fixture(6, "groups/engineering/Onboarding.md", "Onboarding", 9),
  fixture(7, "groups/design/Icon Audit.md", "Icon Audit", 12),
  fixture(8, "users/alice/Archive/Old Plan.txt", "Old Plan", 20),
];

export const DOCS_HOME_STORY_GROUP_ROOTS = [
  { slug: "engineering", label: "Engineering" },
  { slug: "design", label: "Design" },
];

export function mapStoryDocsHomeResults(results: readonly WgwUnifiedSearchResult[]) {
  return mapDocsHomeResults(results, docsHomeStorySession.user.username ?? "alice", {
    groupRoots: DOCS_HOME_STORY_GROUP_ROOTS,
  });
}

/**
 * Mock fetcher: 3-per-page browse with offset/hasMore, optional `q` title filter
 * and optional `pathPrefix` drive scope (mirrors the server-side `path_prefix`).
 */
export function createDocsHomePaginatedFetcher(all: WgwUnifiedSearchResult[]): DocsHomeFetcher {
  const PAGE = 3;
  return async (params) => {
    const q = (params.q ?? "").trim().toLowerCase();
    const prefix = params.pathPrefix?.trim() ?? "";
    const scoped = prefix ? all.filter((item) => item.sourceKey.startsWith(`${prefix}/`)) : all;
    const filtered = q ? scoped.filter((item) => item.title.toLowerCase().includes(q)) : scoped;
    const start = params.offset ?? 0;
    const results = filtered.slice(start, start + PAGE);
    const data: WgwUnifiedSearchData = {
      query: params.q ?? "",
      limit: params.limit ?? PAGE,
      offset: start,
      hasMore: start + results.length < filtered.length,
      sources: params.sources ?? ["file"],
      filters: {
        categories: params.categories,
        extensions: params.extensions,
        path_prefix: prefix || null,
      },
      results,
    };
    return data;
  };
}

/**
 * In-memory drive operations so the row actions (star/download/rename/move/trash)
 * are functional in Storybook. Stars toggle optimistically; mutations resolve no-op.
 */
export function createMockDocsHomeOperations(
  initialStars: string[] = [],
  myDriveNames: string[] = [],
): DriveAPIOperations {
  const stars = new Set(initialStars);
  const data = {} as DriveUIData;
  const listing = {
    directory: { files: myDriveNames.map((name) => ({ name })) },
  } as unknown as DriveUIData;
  return {
    refreshState: async () => data,
    changeDir: async () => data,
    listDirectory: async () => listing,
    search: async () => [],
    createFolder: async () => data,
    createFile: async () => data,
    renameItem: async () => data,
    deleteItems: async () => data,
    downloadFile: async () => {},
    readFileBlob: async () => new Blob(),
    checkUploadReady: async () => {},
    listStars: async () => Array.from(stars),
    listEntriesByPaths: async () => [],
    setStar: async ({ path, starred }) => {
      if (starred) stars.add(path);
      else stars.delete(path);
    },
    uploadFiles: async () => data,
  };
}
