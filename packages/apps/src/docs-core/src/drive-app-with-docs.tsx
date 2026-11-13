import { DriveApp } from "@/drive-core/src/drive-app";
import type { DriveAppProps } from "@/drive-core/src/drive-app-props";
import { useDocsDriveHandoff } from "@/docs-core/src/use-docs-drive-handoff";

/**
 * Live Drive with Docs filling its hand-off slot: open in Docs and Save as
 * Markdown (#2116). The shell's `/drive` route renders this; Drive itself
 * does not import Docs.
 */
export function DriveAppWithDocs(props: Omit<DriveAppProps, "useDocsHandoff">) {
  return <DriveApp {...props} useDocsHandoff={useDocsDriveHandoff} />;
}
