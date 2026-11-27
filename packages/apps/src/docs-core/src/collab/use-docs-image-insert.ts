import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

type ReplaceTarget = { pos: number; src: string | null };

/**
 * Where the image to replace sits now. Remote edits replace the document, so the position saved
 * at open is trusted only while it still holds an image with the same `src`; otherwise the image
 * is looked up again by `src`. Null when it is gone.
 */
export function findDocsImageToReplace(editor: Editor, target: ReplaceTarget): number | null {
  const { doc } = editor.state;
  const at = target.pos <= doc.content.size ? doc.nodeAt(target.pos) : null;
  if (at?.type.name === "image" && (at.attrs.src ?? null) === target.src) return target.pos;
  if (target.src == null) return null;
  let found: number | null = null;
  doc.descendants((node, pos) => {
    if (found != null) return false;
    if (node.type.name === "image" && node.attrs.src === target.src) found = pos;
    return true;
  });
  return found;
}

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

  // Taken by the pick or upload that starts next, so it is a ref and not state.
  const replaceTargetRef = useRef<ReplaceTarget | null>(null);
  const setReplaceTarget = useCallback((target: ReplaceTarget | null) => {
    replaceTargetRef.current = target;
  }, []);

  const openPicker = useCallback(() => {
    if (!enabled) return;
    setReplaceTarget(null);
    setPickerOpen(true);
  }, [enabled, setReplaceTarget]);

  const openReplacePicker = useCallback(
    (pos: number) => {
      if (!enabled) return;
      const node = editor && !editor.isDestroyed ? editor.state.doc.nodeAt(pos) : null;
      setReplaceTarget({ pos, src: node?.type.name === "image" ? (node.attrs.src ?? null) : null });
      setPickerOpen(true);
    },
    [editor, enabled, setReplaceTarget],
  );

  const closePicker = useCallback(() => {
    setPickerOpen(false);
    setReplaceTarget(null);
  }, [setReplaceTarget]);

  useEffect(() => {
    if (!pickerOpen || !operations) return;
    const controller = new AbortController();
    void fetchGroupRootsFromDrive(operations, { signal: controller.signal }).then((roots) => {
      if (!controller.signal.aborted) setGroupRoots(roots);
    });
    return () => controller.abort();
  }, [operations, pickerOpen]);

  const insertNode = useCallback(
    (nodeId: string, alt: string, target: ReplaceTarget | null) => {
      if (!editor || editor.isDestroyed) return;
      if (target) {
        const pos = findDocsImageToReplace(editor, target);
        if (pos == null || !replaceDocsImageAt(editor, pos, nodeId, alt)) {
          showError(insertErrorMessage);
        }
        return;
      }
      insertDocsImageFromNodeId(editor, nodeId, alt);
    },
    [editor, insertErrorMessage, showError],
  );

  /** Hands the pending target to the pick or upload that starts now, so nothing else can reuse it. */
  const takeReplaceTarget = useCallback(() => {
    const target = replaceTargetRef.current;
    setReplaceTarget(null);
    return target;
  }, [setReplaceTarget]);

  const onSelectFile = useCallback(
    (file: DriveFile) => {
      if (!enabled) return;
      setPickerOpen(false);
      const target = takeReplaceTarget();
      const apiPath = file.apiPath;
      if (!apiPath) {
        showError(insertErrorMessage);
        return;
      }
      void (async () => {
        try {
          const nodeId = await resolveDriveFileNodeId(apiPath);
          insertNode(nodeId, file.title || "", target);
        } catch {
          showError(insertErrorMessage);
        }
      })();
    },
    [enabled, insertErrorMessage, insertNode, showError, takeReplaceTarget],
  );

  const onUploadFiles = useCallback(
    (files: File[]) => {
      if (!enabled || !docApiPath) return;
      // Replacing swaps one picture: only the first file counts.
      const all = files.filter(isDocsImageFile);
      if (all.length === 0) return;
      setPickerOpen(false);
      const target = takeReplaceTarget();
      const images = target ? all.slice(0, 1) : all;
      void (async () => {
        try {
          for (const file of images) {
            const uploaded = await uploadDocAttachmentImage(docApiPath, file);
            insertNode(uploaded.nodeId, uploaded.alt, target);
          }
        } catch {
          showError(insertErrorMessage);
        }
      })();
    },
    [docApiPath, enabled, insertErrorMessage, insertNode, showError, takeReplaceTarget],
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
