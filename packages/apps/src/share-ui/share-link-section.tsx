import { useEffect, useState } from "react";
import { Copy, Globe2, Lock, RefreshCw } from "lucide-react";
import { Card } from "@/card/src/card";
import { IconButton } from "@/button/src/icon-button";
import { buttonVariants } from "@/button/src/button";
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
import type { DriveShareAtPath } from "@wgw-api-generated/drive-types";
import { ShareDialogInput } from "@/share-ui/share-dialog-input";
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
};

type ConfirmAction =
  | "disable-public"
  | "disable-password"
  | "regenerate-link"
  | "regenerate-password";

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

export function ShareLinkSection({ atPath, mutations, disabled = false }: ShareLinkSectionProps) {
  const directPublic = findDirectPublicShare(atPath);
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
          const password = await mutations.updatePublicPassword(true, "");
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
    <Card
      titleIcon={<Globe2 className="size-4" />}
      title={shareLabels.publicSectionTitle}
      description={enabled ? shareLabels.publicEnabledHint : shareLabels.publicDisabledHint}
      action={
        <span className="share-dialog__switch-touch">
          <Switch
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
            aria-label={shareLabels.enablePublicAccess}
          />
        </span>
      }
    >
      {enabled && directPublic ? (
        <div className="share-dialog__link-controls">
          <div className="share-dialog__link-row">
            <ShareDialogInput
              type="text"
              value={url}
              readOnly
              mono
              aria-label={shareLabels.publicSectionTitle}
            />
            <IconButton
              label={shareLabels.copyLink}
              icon={<Copy className="size-3.5" aria-hidden />}
              size="sm"
              variant="outline"
              disabled={!token}
              onClick={() => void handleCopyLink()}
            />
            <IconButton
              label={shareLabels.regenerateLink}
              icon={<RefreshCw className="size-3.5" aria-hidden />}
              size="sm"
              variant="outline"
              title={shareLabels.regenerateLinkHint}
              disabled={disabled}
              onClick={() => setConfirmAction("regenerate-link")}
            />
          </div>

          <div className="share-dialog__password-row">
            <Lock className="share-dialog__password-icon" aria-hidden />
            <span className="share-dialog__password-label">{shareLabels.requirePassword}</span>
            <span className="share-dialog__switch-touch">
              <Switch
                checked={passwordRequired}
                disabled={disabled || passwordBusy}
                aria-label={shareLabels.requirePassword}
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
            </span>
            <div className="share-dialog__password-field">
              <ShareDialogInput
                type="text"
                value={passwordFieldValue}
                readOnly
                mono
                disabled={!passwordRequired || disabled || passwordBusy}
                aria-label={
                  passwordRevealed
                    ? shareLabels.requirePassword
                    : passwordRequired
                      ? shareLabels.passwordHiddenLabel
                      : shareLabels.passwordDisabledPlaceholder
                }
                placeholder={passwordRequired ? undefined : shareLabels.passwordDisabledPlaceholder}
              />
              {passwordRevealed ? (
                <IconButton
                  label={shareLabels.copyPassword}
                  icon={<Copy className="size-3.5" aria-hidden />}
                  size="sm"
                  variant="outline"
                  disabled={disabled || passwordBusy}
                  onClick={() => void handleCopyPassword()}
                />
              ) : null}
              <IconButton
                label={shareLabels.regeneratePassword}
                icon={<RefreshCw className="size-3.5" aria-hidden />}
                size="sm"
                variant="outline"
                title={
                  passwordRequired && !passwordRevealed
                    ? shareLabels.regeneratePasswordToViewHint
                    : shareLabels.regeneratePasswordHint
                }
                disabled={!passwordRequired || disabled || passwordBusy}
                onClick={() => setConfirmAction("regenerate-password")}
              />
            </div>
          </div>
        </div>
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
    </Card>
  );
}
