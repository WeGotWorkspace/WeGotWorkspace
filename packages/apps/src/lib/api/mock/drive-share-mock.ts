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

function cloneAtPath(path: string): DriveShareAtPath {
  return {
    ...mockDriveShareAtPath,
    path,
  };
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
      const created: DriveShare = {
        id: `mock-share-${nextShareId++}`,
        path: body.path,
        kind: body.kind,
        defaultAccess: body.defaultAccess,
        publicToken: body.kind === "public" ? `mock-token-${Date.now()}` : null,
        hasPassword: Boolean(body.password),
        expiresAt: body.expiresAt ?? null,
        updatedAt: new Date().toISOString(),
        shareWith: body.shareWith ?? null,
        myRights: fullDriveMyRights,
      };
      return created;
    },
    async patchShare(shareId, body: DriveShareUpdateRequest) {
      const direct =
        mockDriveShareAtPath.directShares.find((entry) => entry.share.id === shareId)?.share ??
        mockDriveShareAtPath.directShares[0]?.share;
      if (!direct || direct.id !== shareId) {
        throw new Error(`Share not found: ${shareId}`);
      }
      const passwordProvided = Object.prototype.hasOwnProperty.call(body, "password");
      const nextPassword = passwordProvided ? body.password : direct.hasPassword;
      return {
        ...direct,
        defaultAccess: body.defaultAccess ?? direct.defaultAccess,
        expiresAt: body.expiresAt === undefined ? direct.expiresAt : body.expiresAt,
        shareWith: body.shareWith === undefined ? direct.shareWith : body.shareWith,
        hasPassword: passwordProvided
          ? nextPassword !== null && nextPassword !== ""
          : direct.hasPassword,
        updatedAt: body.updatedAt,
      };
    },
    async deleteShare() {
      return;
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
