import { useState } from "react";
import { Mail, Trash2 } from "lucide-react";
import type { DriveShareAtPath } from "@wgw-api-generated/drive-types";
import { Button } from "@/button/src/button";
import { IconButton } from "@/button/src/icon-button";
import { Input } from "@/ui/input";
import { initialsFromDisplayName } from "@/user-avatar/src/user-avatar";
import { accessToUIPermission, type ShareUIPermission } from "@/share-ui/share-access-map";
import { shareLabels } from "@/share-ui/share-labels";
import { SharePermissionSelect } from "@/share-ui/share-permission-select";
import type { ShareMutations } from "@/share-ui/use-share-mutations";

type ShareGuestSectionProps = {
  atPath: DriveShareAtPath;
  mutations: ShareMutations;
  disabled?: boolean;
};

export function ShareGuestSection({ atPath, mutations, disabled = false }: ShareGuestSectionProps) {
  const guestGrants = atPath.effectiveGrants.filter((grant) => grant.principalType === "email");
  const [newEmail, setNewEmail] = useState("");
  const [newPermission, setNewPermission] = useState<ShareUIPermission>("view");

  const addGuest = () => {
    const email = newEmail.trim();
    if (!email) return;
    void mutations.inviteGuest(email, newPermission).then(() => {
      setNewEmail("");
      setNewPermission("view");
    });
  };

  return (
    <section>
      <div className="share-dialog__section-heading">
        <Mail className="share-dialog__section-icon" aria-hidden />
        <h3 className="share-dialog__section-title">{shareLabels.guestSectionTitle}</h3>
      </div>
      <p className="share-dialog__section-hint">{shareLabels.guestSectionHint}</p>

      <div className="share-dialog__panel">
        {guestGrants.map((grant) => {
          const permission = accessToUIPermission(grant.access) ?? "view";
          const pending = grant.status === "pending";
          return (
            <div key={grant.principal} className="share-dialog__row">
              <div className="share-dialog__guest-mark share-dialog__group-mark--idle">
                {initialsFromDisplayName(grant.principal)}
              </div>
              <div className="share-dialog__row-main">
                <div className="share-dialog__row-title-line">
                  <span className="share-dialog__row-title">{grant.principal}</span>
                  {pending ? (
                    <span className="share-dialog__pending-badge">{shareLabels.pendingGuest}</span>
                  ) : null}
                </div>
              </div>
              <SharePermissionSelect
                value={permission}
                disabled={disabled || pending || !grant.removal}
                onChange={(next) => {
                  if (next === "none" || !grant.removal?.principal) return;
                  void mutations.updateGrantAccess(
                    grant.removal.shareId,
                    grant.removal.principal,
                    next,
                  );
                }}
              />
              {grant.removal ? (
                <IconButton
                  label={shareLabels.removeGuest}
                  icon={<Trash2 className="size-3.5" aria-hidden />}
                  size="sm"
                  variant="ghost"
                  disabled={disabled}
                  onClick={() => {
                    if (grant.inviteId) {
                      void mutations.removeGuestInvite(grant.removal!.shareId, grant.inviteId);
                      return;
                    }
                    if (grant.removal?.principal) {
                      void mutations.updateGrantAccess(
                        grant.removal.shareId,
                        grant.removal.principal,
                        null,
                      );
                    }
                  }}
                />
              ) : null}
            </div>
          );
        })}

        <div className="share-dialog__guest-composer">
          <Input
            type="email"
            value={newEmail}
            disabled={disabled}
            placeholder={shareLabels.invitePlaceholder}
            className="share-dialog__guest-input"
            onChange={(event) => setNewEmail(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") addGuest();
            }}
          />
          <SharePermissionSelect
            value={newPermission}
            onChange={(next) => {
              if (next !== "none") setNewPermission(next);
            }}
          />
          <Button size="sm" className="h-8" disabled={disabled} onClick={addGuest}>
            {shareLabels.inviteAction}
          </Button>
        </div>
      </div>
    </section>
  );
}
