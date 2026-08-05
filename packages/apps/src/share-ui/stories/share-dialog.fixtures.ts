import type { DriveShareAtPath } from "@wgw-api-generated/drive-types";
import type { DriveShareOperations } from "@/drive-core/src/drive-types";
import { mockDriveShareAtPath } from "@/lib/api/mock/drive-share-fixtures";
import { createMockDriveShareOperations } from "@/lib/api/mock/drive-share-mock";

export const SHARE_STORY_PATH = mockDriveShareAtPath.path;
export const SHARE_STORY_TITLE = "report.md";

function cloneAtPath(overrides: Partial<DriveShareAtPath> = {}): DriveShareAtPath {
  return {
    ...mockDriveShareAtPath,
    ...overrides,
  };
}

export const shareStoryAtPathPublicOn = cloneAtPath();

export const shareStoryAtPathPublicPasswordOn = cloneAtPath({
  publicShares: mockDriveShareAtPath.publicShares.map((entry) => ({
    ...entry,
    hasPassword: true,
  })),
  directShares: mockDriveShareAtPath.directShares.map((entry) =>
    entry.share.kind === "public"
      ? {
          ...entry,
          share: {
            ...entry.share,
            hasPassword: true,
          },
        }
      : entry,
  ),
});

export const shareStoryAtPathPublicOff = cloneAtPath({
  publicShares: [],
  directShares: mockDriveShareAtPath.directShares.filter((entry) => entry.share.kind !== "public"),
});

export const shareStoryAtPathInherited = cloneAtPath();

export const shareStoryAtPathReadOnlyMember = cloneAtPath({
  memberAccess: mockDriveShareAtPath.memberAccess.map((member) =>
    member.username === "alice"
      ? {
          ...member,
          editable: false,
          editHint: "Access is inherited from the Projects folder.",
        }
      : member,
  ),
});

export function createShareStoryOperations(
  atPath: DriveShareAtPath = shareStoryAtPathPublicOn,
): DriveShareOperations {
  let currentAtPath = cloneAtPath(atPath);
  const base = createMockDriveShareOperations();
  return {
    ...base,
    getAtPath: async (path) => ({
      ...currentAtPath,
      path,
    }),
    patchShare: async (shareId, body) => {
      const updated = await base.patchShare(shareId, body);
      currentAtPath = {
        ...currentAtPath,
        directShares: currentAtPath.directShares.map((entry) =>
          entry.share.id === shareId ? { ...entry, share: updated } : entry,
        ),
        publicShares: currentAtPath.publicShares.map((entry) =>
          entry.shareId === shareId ? { ...entry, hasPassword: updated.hasPassword } : entry,
        ),
      };
      return updated;
    },
  };
}
