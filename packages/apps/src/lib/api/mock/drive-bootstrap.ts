import type { WorkspaceSession } from "@/lib/workspace/workspace-session";
import { mockWorkspaceSession } from "@/lib/api/mock/workspace-session-mock";
import type { DriveAppBootstrap, DriveUIData } from "@/drive-core/src/drive-types";
import { fullDriveMyRights } from "@/lib/api/mock/drive-mock-my-rights";
export { fullDriveMyRights } from "@/lib/api/mock/drive-mock-my-rights";

export {
  mockDriveShareAtPath,
  mockDriveShareByPrincipal,
  mockDriveSharePrincipals,
} from "@/lib/api/mock/drive-share-fixtures";
export { createMockDriveShareOperations } from "@/lib/api/mock/drive-share-mock";

const now = Math.floor(Date.now() / 1000);

const DEFAULT_DATA: DriveUIData = {
  user: {
    username: "demo.user",
    name: "Demo User",
    role: "user",
    roots: ["/users", "/groups"],
  },
  cwd: "/users",
  directory: {
    location: "/users/",
    files: [
      {
        type: "dir",
        path: "/users/demo.user",
        name: "demo.user",
        size: 0,
        time: now - 3600,
        permissions: 0,
        myRights: fullDriveMyRights,
      },
      {
        type: "file",
        path: "/users/welcome.txt",
        name: "welcome.txt",
        size: 1024,
        time: now - 180,
        permissions: 0,
        myRights: fullDriveMyRights,
        hasShares: true,
        hasPublicShare: true,
      },
    ],
  },
  plugins: [],
};

export function createDriveAppBootstrap(overrides?: {
  data?: DriveUIData;
  session?: WorkspaceSession;
}): DriveAppBootstrap {
  return {
    data: overrides?.data ?? DEFAULT_DATA,
    session: overrides?.session ?? mockWorkspaceSession,
  };
}
