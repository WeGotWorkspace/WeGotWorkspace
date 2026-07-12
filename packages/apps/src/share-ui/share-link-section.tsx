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

type ShareLinkSectionProps = {
  atPath: DriveShareAtPath;
  mutations: ShareMutations;
  disabled?: boolean;
};

type ConfirmAction = "disable-public" | "disable-password" | "regenerate-link";

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
};

export function ShareLinkSection({ atPath, mutations, disabled = false }: ShareLinkSectionProps) {
  const directPublic = findDirectPublicShare(atPath);
  const enabled = Boolean(directPublic);
  const shareRecord = directPublic ? findShareRecord(atPath, directPublic.shareId) : undefined;
  const token = shareRecord?.publicToken ?? null;
  const url = token ? buildPublicShareUrl(token) : "—";
  const [passwordRequired, setPasswordRequired] = useState(directPublic?.hasPassword ?? false);
  const [passwordDraft, setPasswordDraft] = useState("");
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const passwordBusy = Boolean(mutations.busyKey?.startsWith("public-password-"));

  useEffect(() => {
    setPasswordRequired(directPublic?.hasPassword ?? false);
  }, [directPublic?.hasPassword, directPublic?.shareId]);

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
        void mutations.setPublicEnabled(false);
        break;
      case "disable-password":
        setPasswordRequired(false);
        setPasswordDraft("");
        void mutations.updatePublicPassword(false, "");
        break;
      case "regenerate-link":
        void (async () => {
          const generatedPassword = await mutations.regeneratePublicLink();
          if (generatedPassword) {
            setPasswordRequired(true);
            setPasswordDraft(generatedPassword);
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
              }
            })();
          }}
          aria-label={shareLabels.enablePublicAccess}
        />
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
              variant="ghost"
              title={shareLabels.regenerateLinkHint}
              disabled={disabled}
              onClick={() => setConfirmAction("regenerate-link")}
            />
          </div>

          <div className="share-dialog__password-row">
            <Lock className="share-dialog__password-icon" aria-hidden />
            <span className="share-dialog__password-label">{shareLabels.requirePassword}</span>
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
                    }
                  })();
                  return;
                }
                setPasswordRequired(next);
              }}
            />
            <ShareDialogInput
              type="text"
              value={passwordDraft}
              disabled={!passwordRequired || disabled || passwordBusy}
              aria-label={shareLabels.passwordPlaceholder}
              placeholder={
                passwordRequired
                  ? shareLabels.passwordPlaceholder
                  : shareLabels.passwordDisabledPlaceholder
              }
              onChange={(event) => setPasswordDraft(event.target.value)}
              onBlur={() => {
                if (passwordRequired && passwordDraft.trim()) {
                  void mutations.updatePublicPassword(true, passwordDraft);
                }
              }}
            />
          </div>
          {!passwordRequired ? (
            <p className="share-dialog__password-warning">{shareLabels.passwordDisableWarning}</p>
          ) : null}
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
