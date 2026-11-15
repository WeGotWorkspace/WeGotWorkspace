import type { DriveFileActionSource } from "@/drive-core/src/drive-workspace-props";

/** What Drive tells the Docs hand-off about the person and the host app. */
export type DriveDocsHandoffArgs = {
  /** False for guests: they get no Save as Markdown. */
  enabled: boolean;
  /** Signed-in username, for rights on files in their own drive. */
  username?: string;
  /** Portaled dialog theme class of Drive. */
  dialogSurfaceClassName: string;
};

/** How Drive hands a file to Docs: open it, or save a Word file as Markdown. */
export type DriveDocsHandoff = {
  /** Opens a Markdown file in Docs. */
  onOpenDocsFile?: (apiPath: string) => void;
  /** Save as Markdown row actions for Word files, with their dialogs. */
  saveAsMarkdown?: DriveFileActionSource;
};

/**
 * The slot Docs fills so Drive can open files in Docs (#2116). The shell
 * passes Docs' hook in, so Drive does not import Docs. It must be the same
 * function on every render, as with any hook.
 */
export type UseDriveDocsHandoff = (args: DriveDocsHandoffArgs) => DriveDocsHandoff;

const noDocsHandoff: DriveDocsHandoff = {};

/** Without a Docs hand-off Drive offers neither action. */
export function useNoDocsHandoff(_args: DriveDocsHandoffArgs): DriveDocsHandoff {
  return noDocsHandoff;
}
