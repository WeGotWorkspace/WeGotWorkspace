import {
  createWorkspaceSource,
  mocksInBuild,
  mocksNotInBuild,
} from "@/lib/api/create-workspace-source";
import { createMockTeamMembersOperations } from "@/lib/api/mock/team-members";
import { wgwLiveApiEnabled } from "@/lib/api/wgw/http";
import { createWgwTeamMembersOperations, type TeamMembersOperations } from "@/lib/api/wgw/teams";

let mockOperations: TeamMembersOperations | null = null;

/** Live REST with an API; one in-memory mock per page otherwise, so a change survives reopening. */
export function defaultTeamMembersOperations(): TeamMembersOperations {
  return createWorkspaceSource<TeamMembersOperations>({
    isLive: wgwLiveApiEnabled(),
    createLiveSource: createWgwTeamMembersOperations,
    createMockSource: mocksInBuild
      ? () => (mockOperations ??= createMockTeamMembersOperations())
      : mocksNotInBuild,
  });
}
