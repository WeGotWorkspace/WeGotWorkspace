import { useEffect, useState } from "react";
import { Copy, Globe2, Link2, Lock, RefreshCw } from "lucide-react";
import { IconButton } from "@/button/src/icon-button";
import { Switch } from "@/ui/switch";
import { Input } from "@/ui/input";
import type { DriveShareAtPath } from "@wgw-api-generated/drive-types";
import { accessToUIPermission } from "@/share-ui/share-access-map";
import type { ShareUIPermission } from "@/share-ui/share-access-map";
import { shareLabels } from "@/share-ui/share-labels";
import {
  buildPublicShareUrl,
  copyShareText,
  findDirectPublicShare,
  findShareRecord,
} from "@/share-ui/share-path-utils";
import { SharePermissionSelect } from "@/share-ui/share-permission-select";
import type { ShareMutations } from "@/share-ui/use-share-mutations";

type ShareLinkSectionProps = {
  atPath: DriveShareAtPath;
  mutations: ShareMutations;
  disabled?: boolean;
};

export function ShareLinkSection({ atPath, mutations, disabled = false }: ShareLinkSectionProps) {
  const directPublic = findDirectPublicShare(atPath);
  const enabled = Boolean(directPublic);
  const shareRecord = directPublic ? findShareRecord(atPath, directPublic.shareId) : undefined;
  const token = shareRecord?.publicToken ?? null;
  const url = token ? buildPublicShareUrl(token) : "—";
  const permission = accessToUIPermission(directPublic?.defaultAccess ?? "view") ?? "view";
  const [passwordRequired, setPasswordRequired] = useState(directPublic?.hasPassword ?? false);
  const [passwordDraft, setPasswordDraft] = useState("");
  const passwordBusy = Boolean(mutations.busyKey?.startsWith("public-password-"));

  useEffect(() => {
    setPasswordRequired(directPublic?.hasPassword ?? false);
    setPasswordDraft("");
  }, [directPublic?.shareId, directPublic?.hasPassword]);

  const handleCopy = async () => {
    if (!token) return;
    const copied = await copyShareText(url);
    if (copied) {
      await mutations.copyPublicLink();
    }
  };

  return (
    <section>
      <div className="share-dialog__section-heading">
        <Globe2 className="share-dialog__section-icon" aria-hidden />
        <h3 className="share-dialog__section-title">{shareLabels.publicSectionTitle}</h3>
        <Switch
          className="ml-auto"
          checked={enabled}
          disabled={disabled || mutations.busyKey === "public-toggle"}
          onCheckedChange={(next) => void mutations.setPublicEnabled(next)}
          aria-label={shareLabels.enablePublicAccess}
        />
      </div>
      <p className="share-dialog__section-hint">
        {enabled ? shareLabels.publicEnabledHint : shareLabels.publicDisabledHint}
      </p>

      {enabled && directPublic ? (
        <div className="share-dialog__link-controls">
          <div className="share-dialog__link-row">
            <SharePermissionSelect
              value={permission}
              disabled={disabled || Boolean(mutations.busyKey?.startsWith("public-access-"))}
              onChange={(next) => {
                if (next === "none") return;
                void mutations.updatePublicAccess(next as ShareUIPermission);
              }}
            />
            <div className="share-dialog__link-field">
              <Link2 className="share-dialog__link-field-icon" aria-hidden />
              <span className="share-dialog__link-url">{url}</span>
            </div>
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
              onClick={() => void mutations.regeneratePublicLink()}
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
                setPasswordRequired(next);
                if (!next) {
                  setPasswordDraft("");
                  void mutations.updatePublicPassword(false, "");
                }
              }}
            />
            <Input
              type="text"
              value={passwordDraft}
              disabled={!passwordRequired || disabled || passwordBusy}
              aria-label={shareLabels.passwordPlaceholder}
              placeholder={
                passwordRequired
                  ? shareLabels.passwordPlaceholder
                  : shareLabels.passwordDisabledPlaceholder
              }
              className="share-dialog__password-input"
              onChange={(event) => setPasswordDraft(event.target.value)}
              onBlur={() => {
                if (passwordRequired && passwordDraft.trim()) {
                  void mutations.updatePublicPassword(true, passwordDraft);
                }
              }}
            />
          </div>
        </div>
      ) : null}
    </section>
  );
}
