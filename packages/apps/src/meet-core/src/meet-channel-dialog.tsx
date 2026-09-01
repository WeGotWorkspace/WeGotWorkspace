import { useEffect, useState } from "react";
import { Button } from "@/button/src/button";
import { Input } from "@/ui/input";
import { FieldLabelRow } from "@/ui/field-label-row";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/ui/dialog";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import {
  groupSlugFromOwnerScopeValue,
  OwnerScopeField,
  ownerScopeValueFromDirectory,
  PERSONAL_SCOPE_VALUE,
  type OwnerScopeGroupOption,
} from "@/ui/owner-scope-field";
import { CollectionShareSection } from "@/share-ui/collection-share-section";
import type { CollectionSharePrincipal, CollectionShareWith } from "@/share-ui/collection-share";
import { MeetShareButton } from "@/meet-core/src/meet-share";
import { buildMeetGuestCallLink } from "@/meet-core/src/meet-route-search";
import { meetLabels } from "@/meet-core/src/meet-labels";
import type { MeetChannelKind } from "@/meet-core/src/meet-types";
import "@/share-ui/share-ui.css";
import "./meet-channel-dialog.css";

export type MeetChannelDialogState =
  | null
  | { mode: "create"; kind: MeetChannelKind }
  | {
      mode: "edit";
      channelId: string;
      name: string;
      kind: MeetChannelKind;
      scope: "personal" | "group";
      groupSlug: string | null;
      mayShare?: boolean;
      isSharee?: boolean;
      shareWith?: CollectionShareWith | null;
      canChangeOwner?: boolean;
      guestRoomCode?: string | null;
    };

export type MeetChannelDialogConfirmInput = {
  name: string;
  kind: MeetChannelKind;
  groupSlug?: string | null;
};

export type MeetChannelDialogShare = {
  knownPrincipals?: readonly CollectionSharePrincipal[];
  online?: boolean;
  onSearchPrincipals: (query: string) => Promise<CollectionSharePrincipal[]>;
  onPatchShareWith: (channelId: string, shareWith: CollectionShareWith) => Promise<void>;
};

type MeetChannelDialogProps = {
  dialog: MeetChannelDialogState;
  groups: OwnerScopeGroupOption[];
  personalOwnerLabel: string;
  onClose: () => void;
  onConfirm: (input: MeetChannelDialogConfirmInput) => void;
  contentClassName?: string;
  share?: MeetChannelDialogShare;
  onCopyGuestLink?: (link: string) => void;
};

export function MeetChannelDialog({
  dialog,
  groups,
  personalOwnerLabel,
  onClose,
  onConfirm,
  contentClassName = "meet-channel-dialog",
  share,
  onCopyGuestLink,
}: MeetChannelDialogProps) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<MeetChannelKind>("channel");
  const [scopeValue, setScopeValue] = useState(PERSONAL_SCOPE_VALUE);
  const [confirmOwnerOpen, setConfirmOwnerOpen] = useState(false);
  const open = dialog !== null;
  const isCreate = dialog?.mode === "create";
  const showShare = dialog?.mode === "edit" && Boolean(dialog.mayShare) && Boolean(share);
  const canChangeOwner = isCreate || (dialog?.mode === "edit" && Boolean(dialog.canChangeOwner));
  const meetingKind = kind === "meeting";
  const guestRoomCode = dialog?.mode === "edit" ? dialog.guestRoomCode : null;
  const guestLink = guestRoomCode ? buildMeetGuestCallLink(guestRoomCode) : "";

  useEffect(() => {
    if (!dialog) {
      setConfirmOwnerOpen(false);
      return;
    }
    if (dialog.mode === "create") {
      setName("");
      setKind(dialog.kind);
      setScopeValue(PERSONAL_SCOPE_VALUE);
      return;
    }
    setName(dialog.name);
    setKind(dialog.kind);
    setScopeValue(ownerScopeValueFromDirectory(dialog.scope, dialog.groupSlug));
  }, [dialog]);

  const trimmedName = name.trim();
  const ownerUnchanged =
    dialog?.mode === "edit" &&
    ownerScopeValueFromDirectory(dialog.scope, dialog.groupSlug) === scopeValue;
  const unchangedEdit =
    dialog?.mode === "edit" && trimmedName === dialog.name.trim() && ownerUnchanged;
  const canSubmit = Boolean(trimmedName) && (isCreate || !unchangedEdit);
  const ownerTransferPending = dialog?.mode === "edit" && canChangeOwner && !ownerUnchanged;
  const nextOwnerGroupSlug = groupSlugFromOwnerScopeValue(scopeValue);
  const ownerConfirmDescription = nextOwnerGroupSlug
    ? meetLabels.changeChannelOwnerConfirmToGroup(
        groups.find((group) => group.slug === nextOwnerGroupSlug)?.displayName ??
          nextOwnerGroupSlug,
      )
    : meetLabels.changeChannelOwnerConfirmToPersonal;

  const confirmInput = (): MeetChannelDialogConfirmInput => ({
    name: trimmedName,
    kind,
    ...(isCreate || canChangeOwner ? { groupSlug: groupSlugFromOwnerScopeValue(scopeValue) } : {}),
  });

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
        <DialogContent className={contentClassName} aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>
              {isCreate
                ? meetingKind
                  ? meetLabels.newMeeting
                  : meetLabels.newChannel
                : meetingKind
                  ? meetLabels.editMeeting
                  : meetLabels.editChannel}
            </DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!canSubmit) return;
              if (ownerTransferPending) {
                setConfirmOwnerOpen(true);
                return;
              }
              onConfirm(confirmInput());
            }}
          >
            <FieldLabelRow label={meetLabels.channelNameLabel} htmlFor="meet-channel-name">
              <Input
                id="meet-channel-name"
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </FieldLabelRow>

            {isCreate ? (
              <FieldLabelRow label={meetLabels.channelKindLabel} htmlFor="meet-channel-kind">
                <Select value={kind} onValueChange={(value) => setKind(value as MeetChannelKind)}>
                  <SelectTrigger id="meet-channel-kind">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="channel">{meetLabels.channelKindChannel}</SelectItem>
                    <SelectItem value="meeting">{meetLabels.channelKindMeeting}</SelectItem>
                  </SelectContent>
                </Select>
              </FieldLabelRow>
            ) : null}

            <OwnerScopeField
              id="meet-channel-scope"
              value={scopeValue}
              onValueChange={setScopeValue}
              groups={groups}
              personalOwnerLabel={personalOwnerLabel}
              labels={{
                label: meetLabels.channelScopeLabel,
                personal: meetLabels.channelScopePersonal,
                group: meetLabels.channelScopeGroup,
                readOnlyLabel: meetLabels.channelScopeReadOnlyLabel,
              }}
              disabled={!canChangeOwner}
            />

            {showShare && share && dialog?.mode === "edit" ? (
              <div className="meet-channel-dialog__share">
                <CollectionShareSection
                  collectionId={dialog.channelId}
                  shareWith={dialog.shareWith}
                  knownPrincipals={share.knownPrincipals}
                  online={share.online}
                  dialogClassName={contentClassName}
                  copy={{
                    title: meetLabels.shareChannelSectionTitle,
                    hint: meetLabels.shareChannelSectionHint,
                    placeholder: meetLabels.shareChannelAddPlaceholder,
                    empty: meetLabels.shareChannelSearchEmpty,
                    offline: meetLabels.shareChannelOffline,
                    removeTitle: meetLabels.removeChannelShareTitle,
                    removeConfirm: meetLabels.removeChannelShareConfirm,
                  }}
                  onSearchPrincipals={share.onSearchPrincipals}
                  onPatchShareWith={share.onPatchShareWith}
                />
              </div>
            ) : null}

            {meetingKind ? (
              <div className="meet-channel-dialog__guest">
                {guestLink ? (
                  <MeetShareButton link={guestLink} onCopy={() => onCopyGuestLink?.(guestLink)} />
                ) : (
                  <p className="meet-channel-dialog__guest-hint">
                    {meetLabels.guestLinkAfterCreate}
                  </p>
                )}
              </div>
            ) : null}

            <DialogFooter className="meet-channel-dialog__footer">
              <Button type="button" variant="outline" onClick={onClose}>
                {meetLabels.cancel}
              </Button>
              <Button type="submit" disabled={!canSubmit}>
                {isCreate ? meetLabels.createChannelButton : meetLabels.saveChannelButton}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmOwnerOpen} onOpenChange={setConfirmOwnerOpen}>
        <AlertDialogContent className={contentClassName}>
          <AlertDialogHeader>
            <AlertDialogTitle>{meetLabels.changeChannelOwnerConfirmTitle}</AlertDialogTitle>
            <AlertDialogDescription>{ownerConfirmDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{meetLabels.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOwnerOpen(false);
                onConfirm(confirmInput());
              }}
            >
              {meetLabels.changeChannelOwnerConfirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
