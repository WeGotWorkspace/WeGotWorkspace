import { useCallback, useEffect, useMemo, useState } from "react";
import type { Editor } from "@tiptap/react";
import type { DriveFile } from "@/lib/files/drive-models";
import type { DriveAPIOperations } from "@/lib/files/drive-types";
import { fetchGroupRootsFromDrive, type DocsHomeGroupRoot } from "@/docs-core/src/docs-home-drives";
import { useAppToast } from "@/hooks/use-app-toast";
import {
  insertDocsImageFromNodeId,
  replaceDocsImageAt,
} from "@/text-editor-core/src/text-editor-image-commands";
import { setDocsImageUploadHandler } from "@/text-editor-core/src/text-editor-image-paste";
import {
  isDocsImageFile,
  resolveDriveFileNodeId,
  uploadDocAttachmentImage,
} from "@/text-editor-core/docs-collab/docs-image-upload";

export type UseDocsImageInsertOptions = {
  editor: Editor | null;
  docApiPath: string | null;
  operations?: DriveAPIOperations;
  enabled: boolean;
  insertErrorMessage: string;
};

export type UseDocsImageInsertResult = {
  pickerOpen: boolean;
  openPicker: () => void;
  /** Same picker, but the pick swaps the picture of the image at `pos` instead of inserting. */
  openReplacePicker: (pos: number) => void;
  closePicker: () => void;
  onSelectFile: (file: DriveFile) => void;
  onUploadFiles: (files: File[]) => void;
  groupRoots: readonly DocsHomeGroupRoot[];
  /** Spread onto the editor: the insert and replace pickers, or nothing when not allowed. */
  editorProps: { onInsertImage?: () => void; onReplaceImage?: (pos: number) => void };
};

export function useDocsImageInsert({
  editor,
  docApiPath,
  operations,
  enabled,
  insertErrorMessage,
}: UseDocsImageInsertOptions): UseDocsImageInsertResult {
  const { showError } = useAppToast();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [groupRoots, setGroupRoots] = useState<DocsHomeGroupRoot[]>([]);

  const [replacePos, setReplacePos] = useState<number | null>(null);

  const openPicker = useCallback(() => {
    if (!enabled) return;
    setReplacePos(null);
    setPickerOpen(true);
  }, [enabled]);

  const openReplacePicker = useCallback(
    (pos: number) => {
      if (!enabled) return;
      setReplacePos(pos);
      setPickerOpen(true);
    },
    [enabled],
  );

  const closePicker = useCallback(() => {
    setPickerOpen(false);
    setReplacePos(null);
  }, []);

  useEffect(() => {
    if (!pickerOpen || !operations) return;
    const controller = new AbortController();
    void fetchGroupRootsFromDrive(operations, { signal: controller.signal }).then((roots) => {
      if (!controller.signal.aborted) setGroupRoots(roots);
    });
    return () => controller.abort();
  }, [operations, pickerOpen]);

  const insertNode = useCallback(
    (nodeId: string, alt: string) => {
      if (!editor || editor.isDestroyed) return;
      if (replacePos != null) {
        replaceDocsImageAt(editor, replacePos, nodeId, alt);
        setReplacePos(null);
        return;
      }
      insertDocsImageFromNodeId(editor, nodeId, alt);
    },
    [editor, replacePos],
  );

  const onSelectFile = useCallback(
    (file: DriveFile) => {
      if (!enabled) return;
      setPickerOpen(false);
      const apiPath = file.apiPath;
      if (!apiPath) {
        showError(insertErrorMessage);
        return;
      }
      void (async () => {
        try {
          const nodeId = await resolveDriveFileNodeId(apiPath);
          insertNode(nodeId, file.title || "");
        } catch {
          showError(insertErrorMessage);
        }
      })();
    },
    [enabled, insertErrorMessage, insertNode, showError],
  );

  const onUploadFiles = useCallback(
    (files: File[]) => {
      if (!enabled || !docApiPath) return;
      // Replacing swaps one picture: only the first file counts.
      const images = files.filter(isDocsImageFile).slice(0, replacePos != null ? 1 : undefined);
      if (images.length === 0) return;
      setPickerOpen(false);
      void (async () => {
        try {
          for (const file of images) {
            const uploaded = await uploadDocAttachmentImage(docApiPath, file);
            insertNode(uploaded.nodeId, uploaded.alt);
          }
        } catch {
          showError(insertErrorMessage);
        }
      })();
    },
    [docApiPath, enabled, insertErrorMessage, insertNode, replacePos, showError],
  );

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    if (!enabled) {
      setDocsImageUploadHandler(editor, null);
      return;
    }
    setDocsImageUploadHandler(editor, onUploadFiles);
    return () => setDocsImageUploadHandler(editor, null);
  }, [editor, enabled, onUploadFiles]);

  const editorProps = useMemo(
    () => (enabled ? { onInsertImage: openPicker, onReplaceImage: openReplacePicker } : {}),
    [enabled, openPicker, openReplacePicker],
  );

  return {
    editorProps,
    pickerOpen,
    openPicker,
    openReplacePicker,
    closePicker,
    onSelectFile,
    onUploadFiles,
    groupRoots,
  };
}
