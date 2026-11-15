import { useCallback, useState } from "react";
import type {
  DriveShareAccess,
  DriveShareAtPath,
  DriveSharePrincipalEntry,
} from "@wgw/openapi-types/drive-types";
import { useAppToast } from "@/hooks/use-app-toast";
import type { DriveShareOperations } from "@/lib/files/drive-types";
import { uiPermissionToAccess, type ShareUIPermission } from "@/lib/sharing/share-access-map";
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

/** The toast text for a failed share change; a conflict also reloads the shares. */
function shareMutationFailure(cause: unknown): { description: string; reload: boolean } {
  const detail = cause instanceof Error ? cause.message : shareLabels.mutationError;
  if (detail.includes("Guest already has access")) {
    return { description: shareLabels.guestAlreadyHasAccess, reload: false };
  }
  if (detail.includes("share_conflict")) {
    return { description: "Someone else changed sharing. Reloading.", reload: true };
  }
  return { description: detail, reload: false };
}

export function useShareMutations({ path, operations, atPath, refetch }: UseShareMutationsArgs) {
  const { showError, showSuccess } = useAppToast();
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const runMutation = useCallback(
    /** True when the change was stored (errors show their own toast). */
    async (key: string, action: () => Promise<void>): Promise<boolean> => {
      setBusyKey(key);
      try {
        await action();
        await refetch();
        return true;
      } catch (cause) {
        const { description, reload } = shareMutationFailure(cause);
        showError(shareLabels.mutationError, { description });
        if (reload) await refetch();
        return false;
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
      const stored = await runMutation(`public-password-${directPublic.shareId}`, async () => {
        await operations.patchShare(directPublic.shareId, {
          updatedAt: share.updatedAt!,
          password: enabled ? trimmed : null,
        });
      });
      return stored && enabled ? trimmed : undefined;
    },
    [atPath, operations, runMutation],
  );

  const regeneratePublicLink = useCallback(async (): Promise<string | undefined> => {
    if (!atPath) return undefined;
    const directPublic = findDirectPublicShare(atPath);
    if (!directPublic) return undefined;
    const share = findShareRecord(atPath, directPublic.shareId);
    const generatedPassword = share?.hasPassword ? generateFriendlySharePassword() : undefined;
    const stored = await runMutation(`public-regenerate-${directPublic.shareId}`, async () => {
      await operations.deleteShare(directPublic.shareId);
      await operations.createShare({
        path,
        kind: "public",
        defaultAccess: directPublic.defaultAccess,
        password: generatedPassword ?? null,
      });
    });
    if (!stored) return undefined;
    showSuccess(shareLabels.regeneratedLink);
    return generatedPassword;
  }, [atPath, operations, path, runMutation, showSuccess]);

  /** A fresh password for the public link (the old one stops working). */
  const regeneratePublicPassword = useCallback(async (): Promise<string | undefined> => {
    const password = await updatePublicPassword(true, "");
    if (password) showSuccess(shareLabels.regeneratedPassword);
    return password;
  }, [showSuccess, updatePublicPassword]);

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
    regeneratePublicPassword,
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
