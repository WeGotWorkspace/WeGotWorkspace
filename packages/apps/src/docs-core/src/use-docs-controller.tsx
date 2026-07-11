import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Pencil } from "lucide-react";
import { useAppToast } from "@/hooks/use-app-toast";
import { parentAndName } from "@/lib/files/api-path";
import { markdownToPlainText } from "@/lib/models/note-body-markdown";
import { mergeDocsLabels, type DocsUILabels } from "@/docs-core/src/docs-labels";
import type { DocsAPIOperations, DocsDocument } from "@/docs-core/src/docs-types";
import { isDocsCollabEditablePath } from "@/docs-core/src/docs-collab-text-files";
import { docsEditorFormatFromFileName } from "@/docs-core/src/docs-editor-format";
import { joinFileNameForRename, splitFileNameForRename } from "@/lib/files/filename-rename";
import type { TextEditorContentFormat } from "@/text-editor-core/src/text-editor-content";
import { migrateCollabPersistence } from "@/text-editor-core/docs-collab";

type UseDocsControllerArgs = {
  filePath: string | null;
  labels?: Partial<DocsUILabels>;
  operations?: DocsAPIOperations;
  /** Mock bootstrap document when no `filePath` (Storybook). */
  initialDocument?: DocsDocument | null;
  /** Public share guests are view-only (no autosave/rename). */
  readOnly?: boolean;
  onFileRenamed?: (apiPath: string) => void;
};

const SAVE_DEBOUNCE_MS = 2500;
const AUTO_SAVE_TOAST_DEBOUNCE_MS = 1200;
const AUTO_SAVE_TOAST_THROTTLE_MS = 8000;

function fileNameFromApiPath(apiPath: string): string {
  return parentAndName(apiPath).from;
}

function resolveActiveApiPath(
  filePath: string | null,
  document: DocsDocument | null,
  initialDocument: DocsDocument | null,
): string | null {
  return filePath ?? document?.apiPath ?? initialDocument?.apiPath ?? null;
}

export function useDocsController({
  filePath,
  labels,
  operations,
  initialDocument = null,
  readOnly = false,
  onFileRenamed,
}: UseDocsControllerArgs) {
  const L = useMemo(() => mergeDocsLabels(labels), [labels]);
  const { show, showError } = useAppToast();
  const [document, setDocument] = useState<DocsDocument | null>(initialDocument);
  const [content, setContent] = useState(() => initialDocument?.content ?? "");
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveInFlightRef = useRef(false);
  const pendingContentRef = useRef<string | null>(null);
  const autoSaveToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastAutoSaveToastAtRef = useRef(0);
  const latestPathRef = useRef<string | null>(
    resolveActiveApiPath(filePath, null, initialDocument),
  );
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renameName, setRenameName] = useState("");
  const [renameExtension, setRenameExtension] = useState("");
  const [renamePending, setRenamePending] = useState(false);

  const queueAutoSaveToast = useCallback(() => {
    if (autoSaveToastTimerRef.current) clearTimeout(autoSaveToastTimerRef.current);
    autoSaveToastTimerRef.current = setTimeout(() => {
      const now = Date.now();
      if (now - lastAutoSaveToastAtRef.current < AUTO_SAVE_TOAST_THROTTLE_MS) {
        autoSaveToastTimerRef.current = null;
        return;
      }
      lastAutoSaveToastAtRef.current = now;
      show(L.toastSaved, { icon: <Check className="size-4" /> });
      autoSaveToastTimerRef.current = null;
    }, AUTO_SAVE_TOAST_DEBOUNCE_MS);
  }, [L.toastSaved, show]);

  const flushSave = useCallback(async () => {
    const path = latestPathRef.current;
    const nextContent = pendingContentRef.current;
    if (!path || !nextContent || !operations || saveInFlightRef.current) return;

    saveInFlightRef.current = true;
    pendingContentRef.current = null;
    try {
      await operations.saveFile(path, nextContent);
      queueAutoSaveToast();
    } catch {
      showError(L.saveError);
      pendingContentRef.current = nextContent;
    } finally {
      saveInFlightRef.current = false;
      if (pendingContentRef.current) {
        void flushSave();
      }
    }
  }, [L.saveError, operations, queueAutoSaveToast, showError]);

  const scheduleSave = useCallback(
    (nextContent: string) => {
      pendingContentRef.current = nextContent;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        void flushSave();
      }, SAVE_DEBOUNCE_MS);
    },
    [flushSave],
  );

  useEffect(() => {
    latestPathRef.current = resolveActiveApiPath(filePath, document, initialDocument);
  }, [document, filePath, initialDocument]);

  useEffect(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    pendingContentRef.current = null;

    if (!filePath) {
      setDocument(initialDocument);
      setContent(initialDocument?.content ?? "");
      setLoadError(false);
      setLoading(false);
      return;
    }

    if (!operations) {
      setDocument(null);
      setContent("");
      setLoadError(false);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setLoadError(false);
    void operations
      .loadFile(filePath)
      .then((loaded) => {
        if (cancelled) return;
        const next: DocsDocument = {
          apiPath: filePath,
          fileName: fileNameFromApiPath(filePath),
          content: loaded,
        };
        setDocument(next);
        setContent(loaded);
      })
      .catch(() => {
        if (cancelled) return;
        setDocument(null);
        setContent("");
        setLoadError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [filePath, initialDocument, operations]);

  useEffect(
    () => () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (autoSaveToastTimerRef.current) clearTimeout(autoSaveToastTimerRef.current);
      const pending = pendingContentRef.current;
      if (pending && latestPathRef.current && operations) {
        void operations.saveFile(latestPathRef.current, pending).catch(() => {});
      }
    },
    [operations],
  );

  const handleContentChange = useCallback(
    (nextContent: string) => {
      setContent(nextContent);
      if (readOnly || !filePath || !operations) return;
      scheduleSave(nextContent);
    },
    [filePath, operations, readOnly, scheduleSave],
  );

  const title = document?.fileName ?? (filePath ? fileNameFromApiPath(filePath) : "");
  const editorFormat: TextEditorContentFormat = docsEditorFormatFromFileName(title);
  const isPlainTextDocument = editorFormat === "text";

  const openRenameDialog = useCallback(() => {
    const { baseName, extension, hasExtension } = splitFileNameForRename(title);
    setRenameName(baseName);
    setRenameExtension(hasExtension ? extension : "");
    setRenameDialogOpen(true);
  }, [title]);

  const closeRenameDialog = useCallback(() => {
    if (renamePending) return;
    setRenameDialogOpen(false);
    setRenameName("");
    setRenameExtension("");
  }, [renamePending]);

  const submitRename = useCallback(async () => {
    const path = latestPathRef.current;
    const nextName = renameExtension
      ? joinFileNameForRename(renameName, renameExtension)
      : renameName.trim();
    if (!path || !nextName || nextName === title) {
      closeRenameDialog();
      return;
    }
    if (!operations?.renameFile) {
      closeRenameDialog();
      return;
    }

    setRenamePending(true);
    try {
      const nextPath = await operations.renameFile(path, nextName);
      if (isDocsCollabEditablePath(path) && isDocsCollabEditablePath(nextPath)) {
        try {
          await migrateCollabPersistence(path.replace(/^\/+/, ""), nextPath.replace(/^\/+/, ""));
        } catch (error) {
          console.warn("[docs-collab] persistence migration failed after rename", error);
        }
      }
      setDocument((current) =>
        current ? { ...current, apiPath: nextPath, fileName: nextName } : current,
      );
      latestPathRef.current = nextPath;
      onFileRenamed?.(nextPath);
      show(`Renamed to “${nextName}”`, { icon: <Pencil className="size-4" /> });
      setRenameDialogOpen(false);
      setRenameName("");
      setRenameExtension("");
    } catch {
      showError(L.renameError);
    } finally {
      setRenamePending(false);
    }
  }, [
    closeRenameDialog,
    L.renameError,
    onFileRenamed,
    operations,
    renameExtension,
    renameName,
    show,
    showError,
    title,
  ]);

  const { wordCount, characterCount } = useMemo(() => {
    const plain = isPlainTextDocument ? content : markdownToPlainText(content);
    return {
      wordCount: plain ? plain.split(/\s+/).filter(Boolean).length : 0,
      characterCount: plain.length,
    };
  }, [content, isPlainTextDocument]);

  return {
    labels: L,
    title,
    editorFormat,
    isPlainTextDocument,
    content,
    wordCount,
    characterCount,
    loading,
    loadError,
    hasFile: !!filePath || !!initialDocument,
    canRename: Boolean(
      !readOnly &&
      resolveActiveApiPath(filePath, document, initialDocument) &&
      operations?.renameFile,
    ),
    readOnly,
    sidebarOpen,
    setSidebarOpen,
    renameDialogOpen,
    renameName,
    setRenameName,
    renameExtension,
    renamePending,
    openRenameDialog,
    closeRenameDialog,
    submitRename,
    onContentChange: handleContentChange,
  };
}
