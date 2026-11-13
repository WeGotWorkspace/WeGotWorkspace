import { useOpenDocsFile } from "@/docs-core/src/use-open-docs-file";
import { useSaveAsMarkdownAction } from "@/docs-core/src/docx-import/use-save-as-markdown-action";
import type { DriveDocsHandoff, DriveDocsHandoffArgs } from "@/drive-core/src/drive-docs-handoff";

/**
 * Docs fills Drive's hand-off slot (#2116): open a file in Docs and Save as
 * Markdown. Drive adds its own "can create files here" gate on top.
 */
export function useDocsDriveHandoff({
  enabled,
  username,
  dialogSurfaceClassName,
}: DriveDocsHandoffArgs): DriveDocsHandoff {
  const onOpenDocsFile = useOpenDocsFile();
  const saveAsMarkdown = useSaveAsMarkdownAction({
    enabled,
    onOpenDocsFile,
    username,
    dialogSurfaceClassName,
  });
  return { onOpenDocsFile, saveAsMarkdown };
}
