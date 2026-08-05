import type { WorkspaceSession } from "@/lib/workspace/workspace-session";
export type { WgwPluginDescriptor } from "@/lib/api/wgw/types";
import type {
  WgwDriveDirectoryData,
  WgwDriveDirectoryEntry,
  WgwPluginDescriptor,
  WgwDriveUserData,
} from "@/lib/api/wgw/types";
import type {
  DriveShare,
  DriveShareAtPath,
  DriveShareByPrincipal,
  DriveShareCreateRequest,
  DriveShareInvite,
  DriveShareInviteCreateRequest,
  DriveSharePrincipalEntry,
  DriveShareRevokeAllPublicResult,
  DriveShareUpdateRequest,
  DriveSharedWithMeEntry,
} from "@wgw-api-generated/drive-types";

export type DriveUIData = {
  user: WgwDriveUserData;
  cwd: string;
  directory: WgwDriveDirectoryData;
  plugins: WgwPluginDescriptor[];
};

export type DriveAppBootstrap = {
  data: DriveUIData;
  session: WorkspaceSession;
};

export type DriveMutationOpts = {
  signal?: AbortSignal;
  /** When false, skip listing refresh after create (e.g. hidden `.Trash` bootstrap). */
  refreshState?: boolean;
};

export type DriveShareMutationOpts = {
  signal?: AbortSignal;
};

export type DriveShareOperations = {
  getAtPath: (path: string, opts?: { signal?: AbortSignal }) => Promise<DriveShareAtPath>;
  getByPrincipal: (
    principal: string,
    scope?: string,
    opts?: { signal?: AbortSignal },
  ) => Promise<DriveShareByPrincipal>;
  searchPrincipals: (
    query: string,
    opts?: { signal?: AbortSignal },
  ) => Promise<DriveSharePrincipalEntry[]>;
  /** Paths shared with the current user via active member grants. */
  listSharedWithMe: (opts?: { signal?: AbortSignal }) => Promise<DriveSharedWithMeEntry[]>;
  createShare: (
    body: DriveShareCreateRequest,
    opts?: DriveShareMutationOpts,
  ) => Promise<DriveShare>;
  patchShare: (
    shareId: string,
    body: DriveShareUpdateRequest,
    opts?: DriveShareMutationOpts,
  ) => Promise<DriveShare>;
  deleteShare: (shareId: string, opts?: DriveShareMutationOpts) => Promise<void>;
  createInvite: (
    shareId: string,
    body: DriveShareInviteCreateRequest,
    opts?: DriveShareMutationOpts,
  ) => Promise<DriveShareInvite>;
  deleteInvite: (shareId: string, inviteId: string, opts?: DriveShareMutationOpts) => Promise<void>;
  revokeAllPublic: (
    path: string,
    opts?: DriveShareMutationOpts,
  ) => Promise<DriveShareRevokeAllPublicResult>;
};

export type DriveUploadProgress = {
  uploadedBytes: number;
  totalBytes: number;
  uploadedChunks: number;
  totalChunks: number;
  currentFileName: string;
  filesCompleted: number;
  filesTotal: number;
};

export type DriveUnifiedSearchResult = {
  id: number;
  sourceType: string;
  sourceKey: string;
  title: string;
  category?: string | null;
  snippet?: string | null;
  size: number;
  /** Unix seconds of the last modification (used for the Modified column). */
  modifiedAt?: number;
  /** Optional browse metadata (e.g. `hasShares` for shared indicators). */
  metadata?: Record<string, unknown>;
};

export type DriveUnifiedSearchDownloadInput = {
  resultId?: number | string;
  sourceType: "caldav" | "carddav";
  sourceKey: string;
};

export type DriveAPIOperations = {
  refreshState: (opts?: { signal?: AbortSignal }) => Promise<DriveUIData>;
  changeDir: (to: string, opts?: { signal?: AbortSignal }) => Promise<DriveUIData>;
  /** List a directory without updating the session working directory. */
  listDirectory: (at: string, opts?: { signal?: AbortSignal }) => Promise<DriveUIData>;
  /** List raw directory children, including dot-prefixed names such as `.Trash`. */
  listAllDirectoryEntries?: (
    at: string,
    opts?: { signal?: AbortSignal },
  ) => Promise<WgwDriveDirectoryEntry[]>;
  search: (
    query: string,
    opts?: { limit?: number; signal?: AbortSignal },
  ) => Promise<WgwDriveDirectoryEntry[]>;
  createFolder: (
    input: { cwd: string; name: string },
    opts?: DriveMutationOpts,
  ) => Promise<DriveUIData>;
  createFile: (
    input: { cwd: string; name: string },
    opts?: DriveMutationOpts,
  ) => Promise<DriveUIData>;
  renameItem: (
    input: { destination: string; from: string; to: string },
    opts?: DriveMutationOpts,
  ) => Promise<DriveUIData>;
  deleteItems: (paths: string[], opts?: { signal?: AbortSignal }) => Promise<DriveUIData>;
  downloadFile: (path: string, opts?: { signal?: AbortSignal }) => Promise<void>;
  readFileBlob: (path: string, opts?: { signal?: AbortSignal }) => Promise<Blob>;
  checkUploadReady: (opts?: { signal?: AbortSignal }) => Promise<void>;
  listStars: (opts?: { signal?: AbortSignal }) => Promise<string[]>;
  listEntriesByPaths: (
    paths: string[],
    opts?: { signal?: AbortSignal },
  ) => Promise<WgwDriveDirectoryEntry[]>;
  setStar: (
    input: { path: string; starred: boolean },
    opts?: { signal?: AbortSignal },
  ) => Promise<void>;
  uploadFiles: (
    input: { cwd: string; files: File[] },
    opts?: {
      signal?: AbortSignal;
      onProgress?: (progress: DriveUploadProgress) => void;
    },
  ) => Promise<DriveUIData>;
  downloadUnifiedSearchRecord?: (
    input: DriveUnifiedSearchDownloadInput,
    opts?: { signal?: AbortSignal },
  ) => Promise<void>;
  ensurePluginSession?: (sessionApiPath: string, opts?: { signal?: AbortSignal }) => Promise<void>;
};
