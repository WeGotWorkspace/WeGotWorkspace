import type { DocsAPIOperations, DocsUIData } from "@/docs-core/src/docs-types";
import type { DocsUILabels } from "@/docs-core/src/docs-labels";
import type { DriveShareOperations } from "@/drive-core/src/drive-types";
import type { WorkspaceSession } from "@/lib/workspace/workspace-session";

export type DocsWorkspaceProps = {
  data: DocsUIData;
  session: WorkspaceSession;
  operations?: DocsAPIOperations;
  shareOperations?: DriveShareOperations;
  /** Drive API path from route search (`?file=…`). */
  filePath?: string | null;
  labels?: Partial<DocsUILabels>;
  onLogout?: () => void;
  /** Called after a successful rename with the new drive API path. */
  onFileRenamed?: (apiPath: string) => void;
  className?: string;
};
