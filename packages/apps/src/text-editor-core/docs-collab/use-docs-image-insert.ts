import { useCallback, useEffect, useState } from "react";
import type { Editor } from "@tiptap/react";
import type { DriveFile } from "@/drive-core/src/drive-models";
import type { DriveAPIOperations } from "@/drive-core/src/drive-types";
import { fetchGroupRootsFromDrive, type DocsHomeGroupRoot } from "@/docs-core/src/docs-home-drives";
import { useAppToast } from "@/hooks/use-app-toast";
import { insertDocsImageFromNodeId } from "@/text-editor-core/src/text-editor-image-commands";
import { setDocsImageUploadHandler } from "@/text-editor-core/src/text-editor-image-paste";
import {
  isDocsImageFile,
  resolveDriveFileNodeId,
  uploadDocAttachmentImage,
} from "./docs-image-upload";

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
  closePicker: () => void;
  onSelectFile: (file: DriveFile) => void;
  onUploadFiles: (files: File[]) => void;
  groupRoots: readonly DocsHomeGroupRoot[];
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

  const openPicker = useCallback(() => {
    if (!enabled) return;
    setPickerOpen(true);
  }, [enabled]);

  const closePicker = useCallback(() => {
    setPickerOpen(false);
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
      insertDocsImageFromNodeId(editor, nodeId, alt);
    },
    [editor],
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
      const images = files.filter(isDocsImageFile);
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
    [docApiPath, enabled, insertErrorMessage, insertNode, showError],
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

  return {
    pickerOpen,
    openPicker,
    closePicker,
    onSelectFile,
    onUploadFiles,
    groupRoots,
  };
}
