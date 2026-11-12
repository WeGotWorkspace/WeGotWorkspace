import { useEffect, useId, useState } from "react";
import { Copy, Globe2, RefreshCw } from "lucide-react";
import { IconButton } from "@/button/src/icon-button";
import { buttonVariants } from "@/button/src/button";
import { FieldLabelRow } from "@/ui/field-label-row";
import { Switch } from "@/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/ui/alert-dialog";
import type { DriveShareAtPath } from "@wgw/openapi-types/drive-types";
import { ShareDialogInput } from "@/share-ui/share-dialog-input";
import { ShareLinkLevelRow, shareLinkLevel } from "@/share-ui/share-link-level-row";
import { shareLabels } from "@/share-ui/share-labels";
import {
  buildPublicShareUrl,
  copyShareText,
  findDirectPublicShare,
  findShareRecord,
} from "@/share-ui/share-path-utils";
import type { ShareMutations } from "@/share-ui/use-share-mutations";

/** Inert mask — never the real secret. Shown when password is set but not freshly revealed. */
export const SHARE_PASSWORD_MASK = "••••••••";

type ShareLinkSectionProps = {
  atPath: DriveShareAtPath;
  mutations: ShareMutations;
  disabled?: boolean;
  /** A folder link may let visitors add files (#1715); a file link stays view-only. */
  isFolder?: boolean;
};

type ConfirmAction =
  "disable-public" | "disable-password" | "regenerate-link" | "regenerate-password";

const confirmDialogCopy: Record<ConfirmAction, { title: string; description: string }> = {
  "disable-public": {
    title: shareLabels.disablePublicLinkTitle,
    description: shareLabels.disablePublicLinkConfirm,
  },
  "disable-password": {
    title: shareLabels.disablePasswordTitle,
    description: shareLabels.disablePasswordConfirm,
  },
  "regenerate-link": {
    title: shareLabels.regenerateLinkTitle,
    description: shareLabels.regenerateLinkConfirm,
  },
  "regenerate-password": {
    title: shareLabels.regeneratePasswordTitle,
    description: shareLabels.regeneratePasswordConfirm,
  },
};

export function ShareLinkSection({
  atPath,
  mutations,
  disabled = false,
  isFolder = false,
}: ShareLinkSectionProps) {
  const directPublic = findDirectPublicShare(atPath);
  const level = shareLinkLevel(directPublic?.defaultAccess);
  const levelBusy = Boolean(mutations.busyKey?.startsWith("public-access-"));
  const enabled = Boolean(directPublic);
  const shareRecord = directPublic ? findShareRecord(atPath, directPublic.shareId) : undefined;
  const token = shareRecord?.publicToken ?? null;
  const url = token ? buildPublicShareUrl(token) : "—";
  const passwordBusy = Boolean(mutations.busyKey?.startsWith("public-password-"));
  const hasPassword = directPublic?.hasPassword ?? false;

  const [passwordRequired, setPasswordRequired] = useState(hasPassword);
  /** Fresh plaintext only for this mount after enable/regenerate — never persisted. */
  const [revealedPassword, setRevealedPassword] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const publicSwitchId = useId();
  const passwordSwitchId = useId();
  const passwordFieldId = useId();

  useEffect(() => {
    setPasswordRequired(hasPassword);
    if (!hasPassword) {
      setRevealedPassword(null);
    }
  }, [hasPassword]);

  useEffect(() => {
    if (!enabled) {
      setRevealedPassword(null);
    }
  }, [enabled]);

  const passwordRevealed = Boolean(passwordRequired && revealedPassword);
  const passwordFieldValue = !passwordRequired
    ? ""
    : passwordRevealed
      ? revealedPassword!
      : SHARE_PASSWORD_MASK;

  const revealPassword = (password: string) => {
    setPasswordRequired(true);
    setRevealedPassword(password);
  };

  const handleCopyLink = async () => {
    if (!token) return;
    const copied = await copyShareText(url);
    if (copied) {
      await mutations.copyPublicLink();
    }
  };

  const handleCopyPassword = async () => {
    if (!revealedPassword) return;
    const copied = await copyShareText(revealedPassword);
    if (copied) {
      await mutations.copySharePassword();
    }
  };

  const handleConfirm = () => {
    if (!confirmAction) return;

    switch (confirmAction) {
      case "disable-public":
        setRevealedPassword(null);
        void mutations.setPublicEnabled(false);
        break;
      case "disable-password":
        setPasswordRequired(false);
        setRevealedPassword(null);
        void mutations.updatePublicPassword(false, "");
        break;
      case "regenerate-link":
        void (async () => {
          const generatedPassword = await mutations.regeneratePublicLink();
          if (generatedPassword) {
            revealPassword(generatedPassword);
          } else {
            setRevealedPassword(null);
          }
        })();
        break;
      case "regenerate-password":
        void (async () => {
          const password = await mutations.regeneratePublicPassword();
          if (password) {
            revealPassword(password);
          }
        })();
        break;
    }

    setConfirmAction(null);
  };

  const dialogCopy = confirmAction ? confirmDialogCopy[confirmAction] : null;

  return (
    <>
      <FieldLabelRow
        layout="inline"
        section
        icon={<Globe2 aria-hidden />}
        label={shareLabels.publicSectionTitle}
        htmlFor={publicSwitchId}
        description={
          !enabled
            ? shareLabels.publicDisabledHint
            : isFolder && level === "edit"
              ? shareLabels.publicEnabledAddFilesHint
              : shareLabels.publicEnabledHint
        }
        below={
          enabled && directPublic ? (
            <div className="share-dialog__link-row">
              <ShareDialogInput
                type="text"
                value={url}
                readOnly
                aria-label={shareLabels.linkLabel}
              />
              <IconButton
                label={shareLabels.copyLink}
                icon={<Copy aria-hidden />}
                variant="outline"
                disabled={!token}
                onClick={() => void handleCopyLink()}
              />
              <IconButton
                label={shareLabels.regenerateLink}
                icon={<RefreshCw aria-hidden />}
                variant="outline"
                title={shareLabels.regenerateLinkHint}
                disabled={disabled}
                onClick={() => setConfirmAction("regenerate-link")}
              />
            </div>
          ) : null
        }
      >
        <Switch
          id={publicSwitchId}
          tooltip={enabled ? shareLabels.turnOffPublicLink : shareLabels.turnOnPublicLink}
          checked={enabled}
          disabled={disabled || mutations.busyKey === "public-toggle"}
          onCheckedChange={(next) => {
            if (!next && enabled) {
              setConfirmAction("disable-public");
              return;
            }
            void (async () => {
              const generatedPassword = await mutations.setPublicEnabled(next);
              if (generatedPassword) {
                revealPassword(generatedPassword);
              }
            })();
          }}
        />
      </FieldLabelRow>

      {enabled && directPublic ? (
        <>
          {isFolder ? (
            <ShareLinkLevelRow
              value={level}
              disabled={disabled || levelBusy}
              onChange={(next) => void mutations.updatePublicAccess(next)}
            />
          ) : null}

          <FieldLabelRow
            layout="inline"
            label={shareLabels.requirePassword}
            htmlFor={passwordSwitchId}
          >
            <Switch
              id={passwordSwitchId}
              tooltip={
                passwordRequired ? shareLabels.stopRequiringPassword : shareLabels.requirePassword
              }
              checked={passwordRequired}
              disabled={disabled || passwordBusy}
              onCheckedChange={(next) => {
                if (!next && passwordRequired) {
                  setConfirmAction("disable-password");
                  return;
                }
                if (next) {
                  setPasswordRequired(true);
                  void (async () => {
                    const password = await mutations.updatePublicPassword(true, "");
                    if (password) {
                      revealPassword(password);
                    }
                  })();
                  return;
                }
                setPasswordRequired(next);
              }}
            />
          </FieldLabelRow>

          {passwordRequired ? (
            <FieldLabelRow
              layout="inline"
              fill
              label={shareLabels.passwordLabel}
              htmlFor={passwordFieldId}
            >
              <div className="share-dialog__link-row">
                <ShareDialogInput
                  id={passwordFieldId}
                  type="text"
                  value={passwordFieldValue}
                  readOnly
                  disabled={disabled || passwordBusy}
                  aria-description={passwordRevealed ? undefined : shareLabels.passwordHiddenLabel}
                />
                {passwordRevealed ? (
                  <IconButton
                    label={shareLabels.copyPassword}
                    icon={<Copy aria-hidden />}
                    variant="outline"
                    disabled={disabled || passwordBusy}
                    onClick={() => void handleCopyPassword()}
                  />
                ) : null}
                <IconButton
                  label={shareLabels.regeneratePassword}
                  icon={<RefreshCw aria-hidden />}
                  variant="outline"
                  title={
                    passwordRevealed
                      ? shareLabels.regeneratePasswordHint
                      : shareLabels.regeneratePasswordToViewHint
                  }
                  disabled={disabled || passwordBusy}
                  onClick={() => setConfirmAction("regenerate-password")}
                />
              </div>
            </FieldLabelRow>
          ) : null}
        </>
      ) : null}

      <AlertDialog open={!!confirmAction} onOpenChange={(open) => !open && setConfirmAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{dialogCopy?.title}</AlertDialogTitle>
            <AlertDialogDescription>{dialogCopy?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{shareLabels.confirmCancel}</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              onClick={handleConfirm}
            >
              {shareLabels.confirmContinue}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
