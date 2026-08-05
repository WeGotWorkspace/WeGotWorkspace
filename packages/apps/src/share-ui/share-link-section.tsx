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
import {
  clearStoredSharePassword,
  readStoredSharePassword,
  writeStoredSharePassword,
} from "@/share-ui/share-password-storage";
import type { ShareMutations } from "@/share-ui/use-share-mutations";

function rememberSharePassword(scope: string | undefined, password: string) {
  if (!scope) return;
  writeStoredSharePassword(scope, password);
}

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
  const passwordScope = atPath.path;

  const [passwordRequired, setPasswordRequired] = useState(directPublic?.hasPassword ?? false);
  const [passwordDraft, setPasswordDraft] = useState(() =>
    directPublic?.hasPassword ? readStoredSharePassword(passwordScope) : "",
  );

  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);

  useEffect(() => {
    const hasPassword = directPublic?.hasPassword ?? false;
    setPasswordRequired(hasPassword);
    if (!passwordScope) {
      setPasswordDraft("");
      return;
    }
    if (hasPassword) {
      setPasswordDraft((current) => readStoredSharePassword(passwordScope) || current);
      return;
    }
    clearStoredSharePassword(passwordScope);
    setPasswordDraft("");
  }, [directPublic?.hasPassword, passwordScope]);

  useEffect(() => {
    if (!enabled) {
      setPasswordDraft("");
    }
  }, [enabled]);

  const handleCopy = async () => {
    if (!token) return;
    const copied = await copyShareText(url);
    if (copied) {
      await mutations.copyPublicLink();
    }
  };

  const handleConfirm = () => {
    if (!confirmAction) return;

    switch (confirmAction) {
      case "disable-public":
        clearStoredSharePassword(passwordScope);
        void mutations.setPublicEnabled(false);
        break;
      case "disable-password":
        setPasswordRequired(false);
        setPasswordDraft("");
        clearStoredSharePassword(passwordScope);
        void mutations.updatePublicPassword(false, "");
        break;
      case "regenerate-link":
        void (async () => {
          const generatedPassword = await mutations.regeneratePublicLink();
          if (generatedPassword) {
            setPasswordRequired(true);
            setPasswordDraft(generatedPassword);
            rememberSharePassword(passwordScope, generatedPassword);
          }
        })();
        break;
      case "regenerate-password":
        void (async () => {
          const password = await mutations.updatePublicPassword(true, "");
          if (password) {
            setPasswordRequired(true);
            setPasswordDraft(password);
            rememberSharePassword(passwordScope, password);
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
                  setPasswordRequired(true);
                  setPasswordDraft(generatedPassword);
                  rememberSharePassword(passwordScope, generatedPassword);
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
              onClick={() => void handleCopy()}
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
                      const password = await mutations.updatePublicPassword(true, passwordDraft);
                      if (password) {
                        setPasswordDraft(password);
                        rememberSharePassword(passwordScope, password);
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
                value={passwordDraft}
                readOnly
                mono
                disabled={!passwordRequired || disabled || passwordBusy}
                aria-label={shareLabels.requirePassword}
                placeholder={
                  passwordRequired
                    ? passwordDraft
                      ? undefined
                      : shareLabels.passwordSavedPlaceholder
                    : shareLabels.passwordDisabledPlaceholder
                }
              />
              <IconButton
                label={shareLabels.regeneratePassword}
                icon={<RefreshCw className="size-3.5" aria-hidden />}
                size="sm"
                variant="outline"
                title={shareLabels.regeneratePasswordHint}
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
