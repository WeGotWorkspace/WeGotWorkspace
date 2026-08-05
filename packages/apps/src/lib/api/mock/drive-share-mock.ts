import type {
  DriveShare,
  DriveShareAtPath,
  DriveShareCreateRequest,
  DriveShareInvite,
  DriveShareInviteCreateRequest,
  DriveSharePrincipalEntry,
  DriveShareRevokeAllPublicResult,
  DriveShareUpdateRequest,
} from "@wgw-api-generated/drive-types";
import type { DriveShareOperations } from "@/drive-core/src/drive-types";
import { fullDriveMyRights } from "@/lib/api/mock/drive-mock-my-rights";
import {
  mockDriveShareAtPath,
  mockDriveShareByPrincipal,
  mockDriveSharePrincipals,
} from "@/lib/api/mock/drive-share-fixtures";

const SHARED_FIXTURE_PATH = mockDriveShareAtPath.path;

function cloneAtPath(path: string): DriveShareAtPath {
  if (path !== SHARED_FIXTURE_PATH) {
    return {
      ...mockDriveShareAtPath,
      path,
      directShares: [],
      coveringShares: [],
      nestedShares: [],
      grantSources: [],
      effectiveGrants: [],
      memberAccess: [],
      publicShares: [],
    };
  }
  return {
    ...mockDriveShareAtPath,
    path,
    directShares: mockDriveShareAtPath.directShares.map((entry) => ({
      ...entry,
      share: { ...entry.share },
    })),
    publicShares: mockDriveShareAtPath.publicShares.map((entry) => ({ ...entry })),
  };
}

function syncPublicSummary(share: DriveShare): void {
  const entry = mockDriveShareAtPath.publicShares.find((item) => item.shareId === share.id);
  if (!entry) return;
  entry.hasPassword = share.hasPassword;
  entry.defaultAccess = share.defaultAccess;
}

function filterPrincipals(query: string): DriveSharePrincipalEntry[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [...mockDriveSharePrincipals];
  return mockDriveSharePrincipals.filter((entry) => {
    const haystack = `${entry.principal} ${entry.displayName}`.toLowerCase();
    return haystack.includes(normalized);
  });
}

export function createMockDriveShareOperations(): DriveShareOperations {
  let nextShareId = 1;
  let nextInviteId = 1;

  return {
    async getAtPath(path) {
      return cloneAtPath(path);
    },
    async getByPrincipal(principal, scope) {
      void scope;
      return {
        ...mockDriveShareByPrincipal,
        principal,
      };
    },
    async searchPrincipals(query) {
      return filterPrincipals(query);
    },
    async createShare(body: DriveShareCreateRequest) {
      if (body.kind === "public" && body.defaultAccess !== "view") {
        throw new Error("Public shares only support view access.");
      }
      const hasPassword =
        body.password !== null && body.password !== undefined && body.password.trim() !== "";
      const created: DriveShare = {
        id: `mock-share-${nextShareId++}`,
        path: body.path,
        kind: body.kind,
        defaultAccess: body.defaultAccess,
        publicToken: body.kind === "public" ? `mock-token-${Date.now()}` : null,
        hasPassword,
        expiresAt: body.expiresAt ?? null,
        updatedAt: new Date().toISOString(),
        shareWith: body.shareWith ?? null,
        myRights: fullDriveMyRights,
      };

      if (body.path === SHARED_FIXTURE_PATH) {
        mockDriveShareAtPath.directShares.push({
          share: created,
          relationship: "direct",
          status: "active",
        });
        if (created.kind === "public") {
          mockDriveShareAtPath.publicShares.push({
            shareId: created.id,
            sharePath: created.path,
            defaultAccess: created.defaultAccess,
            hasPassword: created.hasPassword,
            inherited: false,
            status: "active",
          });
        }
      }

      return created;
    },
    async patchShare(shareId, body: DriveShareUpdateRequest) {
      const wrapper = mockDriveShareAtPath.directShares.find((entry) => entry.share.id === shareId);
      const direct = wrapper?.share;
      if (!direct || direct.id !== shareId) {
        throw new Error(`Share not found: ${shareId}`);
      }
      const passwordProvided = Object.prototype.hasOwnProperty.call(body, "password");
      const nextAccess = body.defaultAccess ?? direct.defaultAccess;
      if (direct.kind === "public" && nextAccess !== "view") {
        throw new Error("Public shares only support view access.");
      }
      const hasPassword = passwordProvided
        ? body.password !== null && body.password !== ""
        : direct.hasPassword;

      Object.assign(direct, {
        defaultAccess: nextAccess,
        expiresAt: body.expiresAt === undefined ? direct.expiresAt : body.expiresAt,
        shareWith: body.shareWith === undefined ? direct.shareWith : body.shareWith,
        hasPassword,
        updatedAt: body.updatedAt ?? new Date().toISOString(),
      });
      syncPublicSummary(direct);

      return { ...direct };
    },
    async deleteShare(shareId) {
      const index = mockDriveShareAtPath.directShares.findIndex(
        (entry) => entry.share.id === shareId,
      );
      if (index >= 0) {
        mockDriveShareAtPath.directShares.splice(index, 1);
      }
      mockDriveShareAtPath.publicShares = mockDriveShareAtPath.publicShares.filter(
        (entry) => entry.shareId !== shareId,
      );
    },
    async createInvite(shareId, body: DriveShareInviteCreateRequest) {
      const invite: DriveShareInvite = {
        id: `mock-invite-${nextInviteId++}`,
        email: body.email,
        access: body.access,
        inviteToken: `mock-invite-token-${Date.now()}`,
      };
      void shareId;
      return invite;
    },
    async deleteInvite() {
      return;
    },
    async revokeAllPublic() {
      const result: DriveShareRevokeAllPublicResult = {
        revokedCount: mockDriveShareAtPath.publicShares.length,
        shareIds: mockDriveShareAtPath.publicShares.map((entry) => entry.shareId),
      };
      return result;
    },
  };
}
