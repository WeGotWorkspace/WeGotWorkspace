import { useState } from "react";
import { Mail, Send, Trash2 } from "lucide-react";
import type { DriveShareAtPath } from "@wgw-api-generated/drive-types";
import { Card } from "@/card/src/card";
import { IconButton } from "@/button/src/icon-button";
import { ShareDialogInput } from "@/share-ui/share-dialog-input";
import { initialsFromDisplayName } from "@/user-avatar/src/user-avatar";
import { accessToUIPermission, type ShareUIPermission } from "@/share-ui/share-access-map";
import { SharePendingTag } from "@/share-ui/share-pending-tag";
import { shareLabels } from "@/share-ui/share-labels";
import { SharePermissionSelect } from "@/share-ui/share-permission-select";
import type { ShareMutations } from "@/share-ui/use-share-mutations";

type ShareGuestSectionProps = {
  atPath: DriveShareAtPath;
  mutations: ShareMutations;
  disabled?: boolean;
};

function isValidGuestEmail(value: string): boolean {
  const email = value.trim();
  if (!email.includes("@")) return false;
  const [, domain] = email.split("@");
  return Boolean(domain?.includes("."));
}

export function ShareGuestSection({ atPath, mutations, disabled = false }: ShareGuestSectionProps) {
  const guestGrants = atPath.effectiveGrants.filter((grant) => grant.principalType === "email");
  const [newEmail, setNewEmail] = useState("");
  const [newPermission, setNewPermission] = useState<ShareUIPermission>("view");
  const canInvite = isValidGuestEmail(newEmail);

  const addGuest = () => {
    const email = newEmail.trim();
    if (!isValidGuestEmail(email)) return;
    void mutations.inviteGuest(email, newPermission).then(() => {
      setNewEmail("");
      setNewPermission("view");
    });
  };

  return (
    <Card
      titleIcon={<Mail className="size-4" />}
      title={shareLabels.guestSectionTitle}
      description={shareLabels.guestSectionHint}
    >
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
                  {pending ? <SharePendingTag /> : null}
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
                  variant="outline"
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

        <div className="share-dialog__link-row share-dialog__guest-invite-row">
          <ShareDialogInput
            type="email"
            value={newEmail}
            disabled={disabled}
            placeholder={shareLabels.invitePlaceholder}
            aria-label={shareLabels.invitePlaceholder}
            onChange={(event) => setNewEmail(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && canInvite) addGuest();
            }}
          />
          <SharePermissionSelect
            value={newPermission}
            disabled={disabled}
            onChange={(next) => {
              if (next !== "none") setNewPermission(next);
            }}
          />
          <IconButton
            label={shareLabels.inviteGuest}
            icon={<Send className="size-3.5" aria-hidden />}
            size="sm"
            variant="primary"
            disabled={disabled || !canInvite}
            onClick={addGuest}
          />
        </div>
      </div>
    </Card>
  );
}
