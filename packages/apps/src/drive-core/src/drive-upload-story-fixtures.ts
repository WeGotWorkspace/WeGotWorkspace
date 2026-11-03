import { inferFileKindFromName } from "@/drive-core/src/drive-file-utils";
import type { DriveFile } from "@/drive-core/src/drive-models";
import type {
  DriveUploadBatchView,
  DriveUploadItemView,
  DriveUploadQueueSnapshot,
  DriveUploadQueueState,
} from "@/lib/offline/drive/upload/drive-upload-subscription";

/**
 * Upload queue fixtures for stories and tests (#1502): one file per state a
 * placeholder row can show. The mock Drive user is `demo.user`. The #1522
 * cases (server full, folder gone, no access, no https, signed out) are not
 * in the default set: `DRIVE_UPLOAD_ISSUE_STORY_CASES` holds them.
 */
export type DriveUploadStoryCase =
  | "waiting"
  | "uploading"
  | "uploadingPercent"
  | "assembling"
  | "waitingForAnswer"
  | "failed"
  | "noLocalCopy"
  | "deviceFallback"
  | "serverFull"
  | "targetMissing"
  | "forbidden"
  | "insecureContext"
  | "auth";

export const DRIVE_UPLOAD_STORY_CASES: readonly DriveUploadStoryCase[] = [
  "waiting",
  "uploading",
  "uploadingPercent",
  "assembling",
  "waitingForAnswer",
  "failed",
  "noLocalCopy",
  "deviceFallback",
];

/** One file per failure that has its own actions (#1522). */
export const DRIVE_UPLOAD_ISSUE_STORY_CASES: readonly DriveUploadStoryCase[] = [
  "targetMissing",
  "forbidden",
  "insecureContext",
  "auth",
];

const MB = 1024 * 1024;
const CREATED = Date.UTC(2026, 9, 31, 9, 0);

const ITEMS: Record<DriveUploadStoryCase, Omit<DriveUploadItemView, "id" | "createdAt">> = {
  waiting: item("Quarterly report.pdf", "queued", 4 * MB),
  uploading: item("Team photo.jpg", "uploading", 3 * MB),
  uploadingPercent: { ...item("Launch video.mp4", "uploading", 20 * MB), bytesDone: 9 * MB },
  assembling: {
    ...item("Archive 2025.zip", "uploading", 18 * MB),
    bytesDone: 18 * MB,
    phase: "assembling",
  },
  waitingForAnswer: { ...item("Budget.xlsx", "queued", MB), batchId: "story-batch-ask" },
  failed: {
    ...item("Scan 0042.png", "failed", 2 * MB),
    canRetry: true,
    error: { code: "permanent", message: "Server error" },
  },
  noLocalCopy: {
    ...item("Interview notes.txt", "failed", 12_000),
    error: { code: "no_local_copy", message: "The file is no longer on this device" },
  },
  deviceFallback: { ...item("Contract draft.docx", "queued", 600_000), localCopy: false },
  serverFull: failedItem("Holiday video.mov", 40 * MB, "server_full", true),
  targetMissing: failedItem("Minutes.docx", 80_000, "target_missing", true),
  forbidden: failedItem("Floor plan.pdf", 2 * MB, "forbidden", true),
  insecureContext: failedItem("Backup.tar", 300 * MB, "insecure_context", false),
  auth: failedItem("Logo.svg", 40_000, "auth", true),
};

function failedItem(
  name: string,
  bytesTotal: number,
  code: NonNullable<DriveUploadItemView["error"]>["code"],
  canRetry: boolean,
): Omit<DriveUploadItemView, "id" | "createdAt"> {
  return { ...item(name, "failed", bytesTotal), canRetry, error: { code, message: code } };
}

function item(
  name: string,
  status: DriveUploadItemView["status"],
  bytesTotal: number,
): Omit<DriveUploadItemView, "id" | "createdAt"> {
  return {
    batchId: "story-batch",
    name,
    targetFolder: { kind: "server", id: "fn-story" },
    status,
    bytesDone: 0,
    bytesTotal,
    localCopy: true,
    canRetry: false,
    folderPath: "users/demo.user/Projects",
  };
}

const BATCHES: DriveUploadBatchView[] = [
  { id: "story-batch", status: "released", keepOffline: "remove", notices: [] },
  { id: "story-batch-ask", status: "awaiting_input", keepOffline: "remove", notices: [] },
];

export function driveUploadStoryItemId(storyCase: DriveUploadStoryCase): string {
  return `story-upload-${storyCase}`;
}

/** A queue snapshot holding one file per case, oldest first. */
export function driveUploadStorySnapshot({
  cases = DRIVE_UPLOAD_STORY_CASES,
  state = "running",
}: {
  cases?: readonly DriveUploadStoryCase[];
  state?: DriveUploadQueueState;
} = {}): DriveUploadQueueSnapshot {
  const items = cases.map((storyCase, index) => ({
    ...ITEMS[storyCase],
    id: driveUploadStoryItemId(storyCase),
    createdAt: CREATED + index * 1000,
  }));
  return {
    state,
    items,
    batches: BATCHES,
    hasItems: items.length > 0,
    totalBytes: items.reduce((sum, entry) => sum + entry.bytesTotal, 0),
  };
}

/** Placeholder rows of a folder listing, as the cache serves them for a snapshot. */
export function driveUploadStoryPlaceholders(
  snapshot: Pick<DriveUploadQueueSnapshot, "items">,
  parent = "My Drive/Projects",
): DriveFile[] {
  return snapshot.items.map((entry) => ({
    id: `${parent}/${entry.name}`,
    notebook: "",
    category: "File",
    date: "Today",
    title: entry.name,
    excerpt: "",
    body: [],
    tags: [],
    wordCount: 0,
    parent,
    kind: inferFileKindFromName(entry.name),
    size: "",
    upload: {
      id: entry.id,
      status: entry.status,
      ...(entry.error ? { reason: entry.error.code } : {}),
    },
  }));
}
