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
import {
  groupSlugFromOwnerScopeValue,
  OwnerScopeField,
  ownerScopeValueFromDirectory,
  PERSONAL_SCOPE_VALUE,
  type OwnerScopeGroupOption,
} from "@/ui/owner-scope-field";
import { Copy } from "lucide-react";
import { IconButton } from "@/button/src/icon-button";
import { CollectionShareSection } from "@/share-ui/collection-share-section";
import type { CollectionSharePrincipal, CollectionShareWith } from "@/share-ui/collection-share";
import { ShareDialogInput } from "@/share-ui/share-dialog-input";
import { copyShareText } from "@/share-ui/share-path-utils";
import { buildMeetCollectionInviteLink } from "@/meet-core/src/meet-route-search";
import { meetLabels } from "@/meet-core/src/meet-labels";
import type { MeetChannelKind } from "@/meet-core/src/meet-types";
import { workspaceOnlySharePrincipals } from "@/calendar-core/src/calendar-meet-channel-email";
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
      /** Owner delete in the footer — same gate as Notes/Tasks `mayDelete`. */
      mayDelete?: boolean;
    };

export type MeetChannelDialogConfirmInput = {
  name: string;
  kind: MeetChannelKind;
  groupSlug?: string | null;
};

/** Same meeting/channel destroy confirm used from the edit footer and leftover rows. */
export function MeetDeleteConfirmDialog({
  open,
  meetingKind,
  onOpenChange,
  onConfirm,
  contentClassName = "meet-channel-dialog",
}: {
  open: boolean;
  meetingKind: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  contentClassName?: string;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className={contentClassName}>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {meetingKind
              ? meetLabels.deleteMeetingConfirmTitle
              : meetLabels.deleteChannelConfirmTitle}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {meetingKind
              ? meetLabels.deleteMeetingConfirmDescription
              : meetLabels.deleteChannelConfirmDescription}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button variant="outline">{meetLabels.cancel}</Button>
          </AlertDialogCancel>
          <AlertDialogAction asChild>
            <Button
              variant="destructive"
              onClick={(event) => {
                event.preventDefault();
                onOpenChange(false);
                onConfirm();
              }}
            >
              {meetLabels.delete}
            </Button>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

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
  onDelete?: () => void;
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
  onDelete,
}: MeetChannelDialogProps) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<MeetChannelKind>("channel");
  const [scopeValue, setScopeValue] = useState(PERSONAL_SCOPE_VALUE);
  const [confirmOwnerOpen, setConfirmOwnerOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const open = dialog !== null;
  const isCreate = dialog?.mode === "create";
  const showShare = dialog?.mode === "edit" && Boolean(dialog.mayShare) && Boolean(share);
  const canChangeOwner = isCreate || (dialog?.mode === "edit" && Boolean(dialog.canChangeOwner));
  const canDelete = dialog?.mode === "edit" && dialog.mayDelete === true && Boolean(onDelete);
  const meetingKind = kind === "meeting";
  const workspaceOrigin =
    typeof window !== "undefined" ? window.location.origin : "https://workspace.example.com";
  const guestLink =
    dialog?.mode === "edit"
      ? buildMeetCollectionInviteLink({ id: dialog.channelId, kind }, workspaceOrigin)
      : "";

  useEffect(() => {
    if (!dialog) {
      setConfirmOwnerOpen(false);
      setConfirmDeleteOpen(false);
      return;
    }
    if (dialog.mode === "create") {
      setName("");
      setKind("channel");
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

            {meetingKind ? (
              guestLink ? (
                <FieldLabelRow label={meetLabels.meetingLinkLabel} htmlFor="meet-channel-link">
                  <div className="meet-channel-dialog__link-row share-dialog__link-row">
                    <ShareDialogInput
                      id="meet-channel-link"
                      type="url"
                      value={guestLink}
                      readOnly
                      aria-label={meetLabels.meetingLinkLabel}
                    />
                    <IconButton
                      type="button"
                      label={meetLabels.copyLink}
                      icon={<Copy className="size-3.5" aria-hidden />}
                      size="sm"
                      variant="outline"
                      disabled={!guestLink}
                      onClick={() => {
                        void copyShareText(guestLink);
                        onCopyGuestLink?.(guestLink);
                      }}
                    />
                  </div>
                </FieldLabelRow>
              ) : (
                <p className="meet-channel-dialog__guest-hint">{meetLabels.guestLinkAfterCreate}</p>
              )
            ) : null}

            {showShare && share && dialog?.mode === "edit" ? (
              <div className="meet-channel-dialog__share">
                <CollectionShareSection
                  collectionId={dialog.channelId}
                  shareWith={dialog.shareWith}
                  knownPrincipals={share.knownPrincipals}
                  online={share.online}
                  dialogClassName={contentClassName}
                  accessSelect={false}
                  copy={{
                    title: meetLabels.shareChannelSectionTitle,
                    hint: meetLabels.shareChannelSectionHint,
                    placeholder: meetLabels.shareChannelAddPlaceholder,
                    empty: meetLabels.shareChannelSearchEmpty,
                    offline: meetLabels.shareChannelOffline,
                    removeTitle: meetLabels.removeChannelShareTitle,
                    removeConfirm: meetLabels.removeChannelShareConfirm,
                  }}
                  onSearchPrincipals={async (query) =>
                    workspaceOnlySharePrincipals(await share.onSearchPrincipals(query))
                  }
                  onPatchShareWith={share.onPatchShareWith}
                />
              </div>
            ) : null}

            <DialogFooter className="meet-channel-dialog__footer">
              {canDelete ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="meet-channel-dialog__delete"
                  onClick={() => setConfirmDeleteOpen(true)}
                >
                  {meetingKind ? meetLabels.deleteMeeting : meetLabels.deleteChannel}
                </Button>
              ) : null}
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

      <MeetDeleteConfirmDialog
        open={confirmDeleteOpen}
        meetingKind={meetingKind}
        contentClassName={contentClassName}
        onOpenChange={setConfirmDeleteOpen}
        onConfirm={() => onDelete?.()}
      />
    </>
  );
}
