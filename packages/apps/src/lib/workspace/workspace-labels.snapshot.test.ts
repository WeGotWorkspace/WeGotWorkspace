/**
 * Every user-visible label bag, resolved to plain text and snapshotted (#1641 step b).
 *
 * Moving a string to the shared base in `workspace-labels.ts` must not change what
 * users see, so this snapshot must stay identical through such refactors. Function
 * labels are called with fixed probe arguments. If you change copy on purpose,
 * update the snapshot: `pnpm --dir packages/apps exec vitest run --project unit -u
 * src/lib/workspace/workspace-labels.snapshot.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { defaultCalendarLabels } from "@/calendar-core/src/calendar-labels";
import { chatUiLabels } from "@/chat-ui/src/chat-labels";
import { defaultContactsLabels } from "@/contacts-core/src/contacts-labels";
import { docsLabels } from "@/docs-core/src/docs-labels";
import { driveLabels } from "@/drive-core/src/drive-labels";
import { driveUploadBatchLabels } from "@/drive-core/src/drive-upload-batch-labels";
import { driveUploadIssueLabels } from "@/drive-core/src/drive-upload-issue-labels";
import { docsPageSetupLabels } from "@/lib/docs-page-setup-labels";
import { workspaceDestructiveDialogLabels } from "@/lib/workspace/destructive-dialog";
import { meetLabels } from "@/meet-core/src/meet-labels";
import { defaultNotesLabels } from "@/notes-core/src/notes-labels";
import { MCP_SCOPE_CATALOG } from "@/settings-core/src/mcp-scope-labels";
import {
  noPeopleOrTeamsFoundCopy,
  noTeamYetCopy,
  shareLabels,
  sharePermissionLabels,
} from "@/share-ui/share-labels";
import { defaultTasksLabels } from "@/tasks-core/src/tasks-labels";
import { defaultOwnerScopeLabels } from "@/ui/owner-scope-labels";

/**
 * Arguments every function label is called with: zero, singular, plural, text, and
 * the enum and boolean arguments some labels branch on (Tasks write-refusal and
 * rescue reasons, the Drive upload `withQueue` flag).
 */
const PROBES: readonly (readonly unknown[])[] = [
  [0, 0, 0, 0],
  [1, 1, 1, 1],
  [2, 3, 4, 5],
  ["Alpha", "Beta", "Gamma", "Delta"],
  ["Alpha", "gone", "Gamma", false],
  ["Alpha", "readOnly", "Gamma", false],
  ["Alpha", "notSaved", "Gamma", false],
];

function resolve(value: unknown): unknown {
  if (typeof value === "function") {
    return PROBES.map((args) => {
      try {
        return resolve((value as (...a: unknown[]) => unknown)(...args));
      } catch (error) {
        return `throws: ${(error as Error).message}`;
      }
    });
  }
  if (Array.isArray(value)) return value.map(resolve);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, resolve(entry)]),
    );
  }
  return value;
}

const BAGS: Record<string, unknown> = {
  calendar: defaultCalendarLabels,
  chat: chatUiLabels,
  contacts: defaultContactsLabels,
  docs: docsLabels,
  docsPageSetup: docsPageSetupLabels,
  drive: driveLabels,
  driveUploadBatch: driveUploadBatchLabels,
  driveUploadIssue: driveUploadIssueLabels,
  mcpScopes: MCP_SCOPE_CATALOG,
  meet: meetLabels,
  notes: defaultNotesLabels,
  ownerScope: defaultOwnerScopeLabels,
  share: { ...shareLabels, noPeopleOrTeamsFoundCopy, noTeamYetCopy },
  sharePermissions: sharePermissionLabels,
  tasks: defaultTasksLabels,
  workspaceDestructiveDialog: workspaceDestructiveDialogLabels,
};

describe("workspace label snapshot", () => {
  for (const [name, bag] of Object.entries(BAGS)) {
    it(`resolved labels match the snapshot: ${name}`, () => {
      expect(resolve(bag)).toMatchSnapshot();
    });
  }
});
