import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import { canBrowserPreviewImage } from "@/drive-core/src/drive-file-utils";

export type DocsImageUploadHandler = (files: File[]) => Promise<void> | void;

export function imageFilesFromDataTransfer(data: DataTransfer | null | undefined): File[] {
  if (!data) return [];
  return [...data.files].filter(isPasteableImageFile);
}

function isPasteableImageFile(file: File): boolean {
  if (!file.type.startsWith("image/")) return false;
  const name = file.name?.trim();
  if (!name || !name.includes(".")) return true;
  return canBrowserPreviewImage(name);
}

export function setDocsImageUploadHandler(
  editor: Editor,
  handler: DocsImageUploadHandler | null,
): void {
  const storage = editor.storage as {
    image?: { onUploadImageFiles?: DocsImageUploadHandler | null };
  };
  if (!storage.image) return;
  storage.image.onUploadImageFiles = handler;
}

export function createDocsImagePastePlugin(editor: Editor): Plugin {
  return new Plugin({
    key: new PluginKey("docsImagePaste"),
    props: {
      handlePaste(_view, event) {
        if (!editor.isEditable) return false;
        const files = imageFilesFromDataTransfer(event.clipboardData);
        if (files.length === 0) return false;
        const upload = (
          editor.storage as { image?: { onUploadImageFiles?: DocsImageUploadHandler } }
        ).image?.onUploadImageFiles;
        if (!upload) return false;
        event.preventDefault();
        void upload(files);
        return true;
      },
      handleDrop(_view, event) {
        if (!editor.isEditable) return false;
        const files = imageFilesFromDataTransfer(event.dataTransfer);
        if (files.length === 0) return false;
        const upload = (
          editor.storage as { image?: { onUploadImageFiles?: DocsImageUploadHandler } }
        ).image?.onUploadImageFiles;
        if (!upload) return false;
        event.preventDefault();
        void upload(files);
        return true;
      },
    },
  });
}
