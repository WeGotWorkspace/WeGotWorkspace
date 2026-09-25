import type { DriveShare, DriveShareAtPath } from "@wgw/openapi-types/drive-types";
import type { DriveShareOperations } from "@/drive-core/src/drive-types";
import { fullDriveMyRights } from "@/lib/api/mock/drive-mock-my-rights";
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
    createShare: async (body) => {
      const hasPassword =
        body.password !== null && body.password !== undefined && body.password.trim() !== "";
      const created: DriveShare = {
        id: `story-share-${currentAtPath.directShares.length + 1}`,
        path: body.path,
        kind: body.kind,
        defaultAccess: body.defaultAccess,
        publicToken: body.kind === "public" ? "story-public-token" : null,
        hasPassword,
        expiresAt: body.expiresAt ?? null,
        updatedAt: "2026-07-02T10:00:00.000Z",
        shareWith: body.shareWith ?? null,
        myRights: fullDriveMyRights,
      };
      // At-path returns the full share on directShares and a summary on
      // publicShares (DriveShareService). Non-public kinds are unused here.
      if (body.kind === "public") {
        currentAtPath = {
          ...currentAtPath,
          directShares: [
            ...currentAtPath.directShares,
            { share: created, relationship: "direct", status: "active" },
          ],
          publicShares: [
            ...currentAtPath.publicShares,
            {
              shareId: created.id,
              sharePath: body.path,
              defaultAccess: created.defaultAccess,
              hasPassword,
              inherited: false,
              status: "active",
            },
          ],
        };
      }
      return created;
    },
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
