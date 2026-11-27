import type {
  SpreadsheetAPIOperations,
  SpreadsheetUIData,
} from "@/spreadsheet-core/src/spreadsheet-types";
import type { SpreadsheetUILabels } from "@/spreadsheet-core/src/spreadsheet-labels";
import type { WorkspaceSession } from "@/lib/workspace/workspace-session";

export type SpreadsheetWorkspaceProps = {
  data: SpreadsheetUIData;
  session: WorkspaceSession;
  operations?: SpreadsheetAPIOperations;
  /** Drive API path from route search (`?file=…`). */
  filePath?: string | null;
  labels?: Partial<SpreadsheetUILabels>;
  onLogout?: () => void;
  /** Called after a successful rename with the new drive API path. */
  onFileRenamed?: (apiPath: string) => void;
  className?: string;
};
