import { useCallback, useState } from "react";
import type {
  DriveShareAccess,
  DriveShareAtPath,
  DriveSharePrincipalEntry,
} from "@wgw-api-generated/drive-types";
import { useAppToast } from "@/hooks/use-app-toast";
import type { DriveShareOperations } from "@/drive-core/src/drive-types";
import { uiPermissionToAccess, type ShareUIPermission } from "@/share-ui/share-access-map";
import { generateFriendlySharePassword } from "@/share-ui/generate-friendly-share-password";
import { shareLabels } from "@/share-ui/share-labels";
import {
  findDirectMemberShare,
  findDirectPublicShare,
  findShareRecord,
} from "@/share-ui/share-path-utils";

type UseShareMutationsArgs = {
  path: string;
  operations: DriveShareOperations;
  atPath: DriveShareAtPath | null;
  refetch: () => Promise<DriveShareAtPath | null | undefined>;
};

export function useShareMutations({ path, operations, atPath, refetch }: UseShareMutationsArgs) {
  const { showError, showSuccess } = useAppToast();
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const runMutation = useCallback(
    async (key: string, action: () => Promise<void>) => {
      setBusyKey(key);
      try {
        await action();
        await refetch();
      } catch (cause) {
        const detail = cause instanceof Error ? cause.message : shareLabels.mutationError;
        if (detail.includes("Guest already has access")) {
          showError(shareLabels.mutationError, {
            description: shareLabels.guestAlreadyHasAccess,
          });
          return;
        }
        if (detail.includes("share_conflict")) {
          showError(shareLabels.mutationError, {
            description: "Someone else changed sharing. Reloading.",
          });
          await refetch();
          return;
        }
        showError(shareLabels.mutationError, { description: detail });
      } finally {
        setBusyKey((current) => (current === key ? null : current));
      }
    },
    [refetch, showError],
  );

  const setPublicEnabled = useCallback(
    async (enabled: boolean): Promise<string | undefined> => {
      if (!atPath) return undefined;
      let generatedPassword: string | undefined;
      await runMutation("public-toggle", async () => {
        const directPublic = findDirectPublicShare(atPath);
        if (enabled) {
          if (directPublic) return;
          generatedPassword = generateFriendlySharePassword();
          await operations.createShare({
            path,
            kind: "public",
            defaultAccess: "view",
            password: generatedPassword,
          });
          return;
        }
        if (!directPublic) return;
        await operations.deleteShare(directPublic.shareId);
      });
      return generatedPassword;
    },
    [atPath, operations, path, runMutation],
  );

  const updatePublicAccess = useCallback(
    async (permission: ShareUIPermission) => {
      if (!atPath) return;
      const directPublic = findDirectPublicShare(atPath);
      if (!directPublic) return;
      const share = findShareRecord(atPath, directPublic.shareId);
      if (!share?.updatedAt) return;
      await runMutation(`public-access-${directPublic.shareId}`, async () => {
        await operations.patchShare(directPublic.shareId, {
          updatedAt: share.updatedAt!,
          defaultAccess: uiPermissionToAccess(permission),
        });
      });
    },
    [atPath, operations, runMutation],
  );

  const updatePublicPassword = useCallback(
    async (enabled: boolean, password: string): Promise<string | undefined> => {
      if (!atPath) return undefined;
      const directPublic = findDirectPublicShare(atPath);
      if (!directPublic) return undefined;
      let trimmed = password.trim();
      if (enabled && !trimmed) {
        trimmed = generateFriendlySharePassword();
      }
      const share = findShareRecord(atPath, directPublic.shareId);
      if (!share?.updatedAt) return undefined;
      await runMutation(`public-password-${directPublic.shareId}`, async () => {
        await operations.patchShare(directPublic.shareId, {
          updatedAt: share.updatedAt!,
          password: enabled ? trimmed : null,
        });
      });
      return enabled ? trimmed : undefined;
    },
    [atPath, operations, runMutation],
  );

  const regeneratePublicLink = useCallback(async (): Promise<string | undefined> => {
    if (!atPath) return undefined;
    const directPublic = findDirectPublicShare(atPath);
    if (!directPublic) return undefined;
    const share = findShareRecord(atPath, directPublic.shareId);
    let generatedPassword: string | undefined;
    await runMutation(`public-regenerate-${directPublic.shareId}`, async () => {
      generatedPassword = share?.hasPassword ? generateFriendlySharePassword() : undefined;
      await operations.deleteShare(directPublic.shareId);
      await operations.createShare({
        path,
        kind: "public",
        defaultAccess: directPublic.defaultAccess,
        password: generatedPassword ?? null,
      });
    });
    return generatedPassword;
  }, [atPath, operations, path, runMutation]);

  const updateGrantAccess = useCallback(
    async (shareId: string, principal: string, permission: ShareUIPermission | null) => {
      if (!atPath) return;
      const share = findShareRecord(atPath, shareId);
      if (!share?.updatedAt) return;
      await runMutation(`grant-${shareId}-${principal}`, async () => {
        await operations.patchShare(shareId, {
          updatedAt: share.updatedAt!,
          shareWith: {
            [principal]: permission === null ? null : { access: uiPermissionToAccess(permission) },
          },
        });
      });
    },
    [atPath, operations, runMutation],
  );

  const removeGuestInvite = useCallback(
    async (shareId: string, inviteId: string) => {
      await runMutation(`invite-remove-${inviteId}`, async () => {
        await operations.deleteInvite(shareId, inviteId);
      });
    },
    [operations, runMutation],
  );

  const inviteGuest = useCallback(
    async (email: string, permission: ShareUIPermission) => {
      if (!atPath) return;
      const memberShare = findDirectMemberShare(atPath);
      if (!memberShare) {
        showError(shareLabels.mutationError, { description: "No member share on this path." });
        return;
      }
      await runMutation(`invite-create-${email}`, async () => {
        await operations.createInvite(memberShare.id, {
          email,
          access: uiPermissionToAccess(permission),
        });
      });
    },
    [atPath, operations, runMutation, showError],
  );

  const addTeamGrant = useCallback(
    async (entry: DriveSharePrincipalEntry, permission: ShareUIPermission) => {
      if (!atPath) return;
      let memberShare = findDirectMemberShare(atPath);
      if (!memberShare) {
        memberShare = await operations.createShare({
          path,
          kind: "member",
          defaultAccess: "view",
          shareWith: {
            [entry.principal]: { access: uiPermissionToAccess(permission) },
          },
        });
        await refetch();
        return;
      }
      if (!memberShare.updatedAt) return;
      await runMutation(`add-grant-${entry.principal}`, async () => {
        await operations.patchShare(memberShare!.id, {
          updatedAt: memberShare!.updatedAt!,
          shareWith: {
            [entry.principal]: { access: uiPermissionToAccess(permission) },
          },
        });
      });
    },
    [atPath, operations, path, refetch, runMutation],
  );

  const searchPrincipals = useCallback(
    (query: string) => operations.searchPrincipals(query),
    [operations],
  );

  const copyPublicLink = useCallback(async () => {
    showSuccess(shareLabels.copiedLink);
  }, [showSuccess]);

  const copySharePassword = useCallback(async () => {
    showSuccess(shareLabels.copiedPassword);
  }, [showSuccess]);

  return {
    busyKey,
    setPublicEnabled,
    updatePublicAccess,
    updatePublicPassword,
    regeneratePublicLink,
    updateGrantAccess,
    removeGuestInvite,
    inviteGuest,
    addTeamGrant,
    searchPrincipals,
    copyPublicLink,
    copySharePassword,
  };
}

export type ShareMutations = ReturnType<typeof useShareMutations>;

export function accessLabelForReadOnly(access: DriveShareAccess): string {
  switch (access) {
    case "full":
      return "Full access";
    case "edit":
    case "review":
      return "Can edit";
    case "comment":
      return "Can comment";
    case "view":
      return "Can view";
    default:
      return access;
  }
}
