import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { extensionFromFileName } from "@/drive-core/src/drive-file-utils";
import type { DriveFile } from "@/drive-core/src/drive-models";
import type { DriveAPIOperations } from "@/drive-core/src/drive-types";
import type { FilePreviewPayload } from "@/lib/file-preview/file-preview-types";
import {
  decodeDocsPreviewContent,
  decodeUtf8Preview,
  DOCS_PREVIEW_MAX_BYTES,
  fileSupportsTextPreview,
  formatPreviewText,
  isDocsEditorPreviewFile,
  isLikelyUtf8Text,
  isTextPreviewExtension,
  isUsableTextExcerpt,
  readBlobMediaDimensions,
  TILE_TEXT_FETCH_BYTES,
  TILE_TEXT_PREVIEW_MAX_CHARS,
} from "@/lib/file-preview/file-preview-utils";

const MAX_CONCURRENT_FETCHES = 4;

type PreviewEntry = FilePreviewPayload;

function isMediaPreviewable(file: DriveFile): boolean {
  return (file.kind === "image" || file.kind === "video") && Boolean(file.apiPath);
}

function isTextPreviewable(file: DriveFile): boolean {
  if (file.kind === "folder") return false;
  if (!file.apiPath && !isUsableTextExcerpt(file.excerpt ?? "", file.apiPath)) return false;
  return fileSupportsTextPreview(file.title, file.kind, file.apiPath);
}

function excerptPreview(file: DriveFile): PreviewEntry | null {
  const excerpt = file.excerpt?.trim() ?? "";
  if (!isUsableTextExcerpt(excerpt, file.apiPath)) return null;
  const content = formatPreviewText(excerpt, file.title, TILE_TEXT_PREVIEW_MAX_CHARS);
  return content ? { kind: "text", content } : null;
}

function buildExcerptPreviews(items: readonly DriveFile[]): Record<string, PreviewEntry> {
  const out: Record<string, PreviewEntry> = {};
  for (const file of items) {
    if (!isTextPreviewable(file)) continue;
    const entry = excerptPreview(file);
    if (entry) out[file.id] = entry;
  }
  return out;
}

export type UseDriveGridPreviewsArgs = {
  items: readonly DriveFile[];
  operations?: DriveAPIOperations;
  enabled?: boolean;
  /** Also prefetch for this file (e.g. detail panel active item). */
  extraFile?: DriveFile | null;
};

export function useDriveGridPreviews({
  items,
  operations,
  enabled = true,
  extraFile = null,
}: UseDriveGridPreviewsArgs) {
  const [fetchedPreviews, setFetchedPreviews] = useState<Record<string, PreviewEntry>>({});
  const [richPreviews, setRichPreviews] = useState<Record<string, PreviewEntry>>({});
  const fetchedPreviewsRef = useRef<Record<string, PreviewEntry>>({});
  const richPreviewsRef = useRef<Record<string, PreviewEntry>>({});
  const previewTargetIdsRef = useRef<Set<string>>(new Set());
  const blobUrlsRef = useRef<Record<string, string>>({});
  const inFlightRef = useRef(0);
  const queueRef = useRef<Array<() => void>>([]);

  const previewTargets = useMemo(() => {
    if (!enabled) {
      return extraFile && (isMediaPreviewable(extraFile) || isTextPreviewable(extraFile))
        ? [extraFile]
        : [];
    }
    const map = new Map<string, DriveFile>();
    for (const file of items) {
      // Grid only renders media thumbnails; text/markdown body previews are detail-only.
      if (isMediaPreviewable(file)) {
        map.set(file.id, file);
      }
    }
    if (extraFile && (isMediaPreviewable(extraFile) || isTextPreviewable(extraFile))) {
      map.set(extraFile.id, extraFile);
    }
    return Array.from(map.values());
  }, [enabled, extraFile, items]);

  const textPreviewTargets = useMemo(() => {
    if (!extraFile || !isTextPreviewable(extraFile)) return [] as DriveFile[];
    return [extraFile];
  }, [extraFile]);

  useEffect(() => {
    previewTargetIdsRef.current = new Set(previewTargets.map((file) => file.id));
  }, [previewTargets]);

  const excerptPreviews = useMemo(
    () => buildExcerptPreviews(textPreviewTargets),
    [textPreviewTargets],
  );

  const revokeBlobUrl = useCallback((id: string) => {
    const url = blobUrlsRef.current[id];
    if (url) {
      URL.revokeObjectURL(url);
      delete blobUrlsRef.current[id];
    }
  }, []);

  const setFetchedPreviewEntry = useCallback(
    (id: string, entry: PreviewEntry) => {
      setFetchedPreviews((prev) => {
        const existing = prev[id];
        if (existing?.kind === "blob-url" && entry.kind !== "blob-url") {
          revokeBlobUrl(id);
        }
        if (
          existing?.kind === "blob-url" &&
          entry.kind === "blob-url" &&
          existing.url === entry.url
        ) {
          return prev;
        }
        if (
          existing?.kind === "text" &&
          entry.kind === "text" &&
          existing.content === entry.content
        ) {
          return prev;
        }
        const next = { ...prev, [id]: entry };
        fetchedPreviewsRef.current = next;
        return next;
      });
    },
    [revokeBlobUrl],
  );

  const setRichPreviewEntry = useCallback((id: string, entry: PreviewEntry) => {
    setRichPreviews((prev) => {
      const existing = prev[id];
      if (
        existing?.kind === "docs" &&
        entry.kind === "docs" &&
        existing.content === entry.content
      ) {
        return prev;
      }
      const next = { ...prev, [id]: entry };
      richPreviewsRef.current = next;
      return next;
    });
  }, []);

  const runNext = useCallback(() => {
    while (inFlightRef.current < MAX_CONCURRENT_FETCHES && queueRef.current.length > 0) {
      const task = queueRef.current.shift();
      task?.();
    }
  }, []);

  const enqueue = useCallback(
    (task: () => void) => {
      queueRef.current.push(task);
      runNext();
    },
    [runNext],
  );

  const fetchMediaPreview = useCallback(
    (file: DriveFile) => {
      if (!operations?.readFileBlob || !file.apiPath) return;
      if (fetchedPreviewsRef.current[file.id]?.kind === "blob-url") return;

      enqueue(() => {
        inFlightRef.current += 1;
        void operations
          .readFileBlob(file.apiPath!)
          .then(async (blob) => {
            const url = URL.createObjectURL(blob);
            if (fetchedPreviewsRef.current[file.id]?.kind === "blob-url") {
              URL.revokeObjectURL(url);
              return;
            }
            blobUrlsRef.current[file.id] = url;
            const dimensions =
              file.kind === "image" || file.kind === "video"
                ? await readBlobMediaDimensions(blob, file.kind)
                : null;
            setFetchedPreviewEntry(file.id, {
              kind: "blob-url",
              url,
              ...(dimensions ?? {}),
            });
          })
          .catch(() => {
            // Tile falls back to icon.
          })
          .finally(() => {
            inFlightRef.current -= 1;
            runNext();
          });
      });
    },
    [enqueue, operations, runNext, setFetchedPreviewEntry],
  );

  const fetchTextPreview = useCallback(
    (file: DriveFile) => {
      if (excerptPreview(file)) return;
      if (fetchedPreviewsRef.current[file.id]) return;
      if (!operations?.readFileBlob || !file.apiPath) return;

      enqueue(() => {
        inFlightRef.current += 1;
        void operations
          .readFileBlob(file.apiPath!)
          .then(async (blob) => {
            const slice = blob.slice(0, TILE_TEXT_FETCH_BYTES);
            const buffer = await slice.arrayBuffer();
            const bytes = new Uint8Array(buffer);
            const ext = extensionFromFileName(file.title);
            if (!isTextPreviewExtension(ext) && !isLikelyUtf8Text(bytes)) return;
            const decoded = decodeUtf8Preview(bytes);
            if (!decoded) return;
            const content = formatPreviewText(decoded, file.title, TILE_TEXT_PREVIEW_MAX_CHARS);
            if (!content) return;
            setFetchedPreviewEntry(file.id, { kind: "text", content });
          })
          .catch(() => {
            // Icon fallback.
          })
          .finally(() => {
            inFlightRef.current -= 1;
            runNext();
          });
      });
    },
    [enqueue, operations, runNext, setFetchedPreviewEntry],
  );

  const fetchDocsRichPreview = useCallback(
    (file: DriveFile) => {
      if (!isDocsEditorPreviewFile(file.title, file.apiPath)) return;
      if (richPreviewsRef.current[file.id]?.kind === "docs") return;
      if (!operations?.readFileBlob || !file.apiPath) return;

      enqueue(() => {
        inFlightRef.current += 1;
        void operations
          .readFileBlob(file.apiPath!)
          .then(async (blob) => {
            if (!previewTargetIdsRef.current.has(file.id)) return;
            if (blob.size > DOCS_PREVIEW_MAX_BYTES) return;
            const buffer = await blob.arrayBuffer();
            const bytes = new Uint8Array(buffer);
            const content = decodeDocsPreviewContent(bytes);
            if (content == null) return;
            if (!previewTargetIdsRef.current.has(file.id)) return;
            setRichPreviewEntry(file.id, { kind: "docs", content });
          })
          .catch(() => {
            // Tile/detail fall back to text preview payload.
          })
          .finally(() => {
            inFlightRef.current -= 1;
            runNext();
          });
      });
    },
    [enqueue, operations, runNext, setRichPreviewEntry],
  );

  useEffect(() => {
    if (!enabled && !extraFile) return;

    for (const file of previewTargets) {
      if (isMediaPreviewable(file)) {
        fetchMediaPreview(file);
      }
    }
    for (const file of textPreviewTargets) {
      fetchTextPreview(file);
      fetchDocsRichPreview(file);
    }
  }, [
    enabled,
    extraFile,
    fetchDocsRichPreview,
    fetchMediaPreview,
    fetchTextPreview,
    previewTargets,
    textPreviewTargets,
  ]);

  useEffect(() => {
    const keepIds = new Set(previewTargets.map((file) => file.id));
    setRichPreviews((prev) => {
      let changed = false;
      const next: Record<string, PreviewEntry> = {};
      for (const [id, entry] of Object.entries(prev)) {
        if (keepIds.has(id)) {
          next[id] = entry;
        } else {
          changed = true;
        }
      }
      if (!changed && Object.keys(next).length === Object.keys(prev).length) return prev;
      richPreviewsRef.current = next;
      return next;
    });
  }, [previewTargets]);

  useEffect(() => {
    const keepIds = new Set(previewTargets.map((file) => file.id));
    setFetchedPreviews((prev) => {
      let changed = false;
      const next: Record<string, PreviewEntry> = {};
      for (const [id, entry] of Object.entries(prev)) {
        if (keepIds.has(id)) {
          next[id] = entry;
        } else {
          if (entry.kind === "blob-url") revokeBlobUrl(id);
          changed = true;
        }
      }
      if (!changed && Object.keys(next).length === Object.keys(prev).length) return prev;
      fetchedPreviewsRef.current = next;
      return next;
    });
  }, [previewTargets, revokeBlobUrl]);

  useEffect(() => {
    return () => {
      for (const id of Object.keys(blobUrlsRef.current)) {
        revokeBlobUrl(id);
      }
      fetchedPreviewsRef.current = {};
      richPreviewsRef.current = {};
      queueRef.current = [];
    };
  }, [revokeBlobUrl]);

  const filePreviews = useMemo(
    () => ({ ...excerptPreviews, ...fetchedPreviews }),
    [excerptPreviews, fetchedPreviews],
  );

  return { filePreviews, richPreviews };
}
