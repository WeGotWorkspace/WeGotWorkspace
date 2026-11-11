import { suggestNewMarkdownFileName } from "@/drive-core/src/drive-file-utils";
import { resolveDriveFolderPickerStartPath } from "@/drive-core/src/drive-folder-picker-utils";
import type { DriveFile, ViewKey } from "@/lib/files/drive-models";
import { splitFileNameForRename } from "@/lib/files/filename-rename";

export function resolveCreateMarkdownDialogDefaults(
  view: ViewKey,
  files: readonly DriveFile[],
): { defaultName: string; initialBrowsePath: string } {
  return {
    defaultName: suggestNewMarkdownFileName(files),
    initialBrowsePath: resolveDriveFolderPickerStartPath(view),
  };
}

export function splitMarkdownDialogDefaultName(defaultName: string): {
  baseName: string;
  extension: string;
} {
  const { baseName, extension } = splitFileNameForRename(defaultName);
  return { baseName, extension: extension || ".md" };
}
