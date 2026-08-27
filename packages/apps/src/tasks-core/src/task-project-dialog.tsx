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
} from "@/ui/owner-scope-field";
import { CollectionShareSection } from "@/share-ui/collection-share-section";
import type { CollectionSharePrincipal, CollectionShareWith } from "@/share-ui/collection-share";
import { TaskProjectColorPicker } from "@/tasks-core/src/task-project-color-picker";
import { DEFAULT_TASK_LIST_COLOR, taskListDotColor } from "@/tasks-core/src/tasks-task-utils";
import type { TaskProjectGroupOption } from "@/tasks-core/src/tasks-types";
import type { TasksUILabels } from "@/tasks-core/src/tasks-labels";
import "@/share-ui/share-ui.css";
import "./task-project-dialog.css";

export type TaskProjectDialogState =
  | null
  | { mode: "create" }
  | {
      mode: "edit";
      listId: string;
      name: string;
      color: string | null;
      scope: "personal" | "group";
      groupSlug: string | null;
      mayShare?: boolean;
      isSharee?: boolean;
      shareWith?: CollectionShareWith | null;
      /** Enable Owner (personal ↔ group), same options as create. */
      canChangeOwner?: boolean;
    };

export type TaskProjectDialogConfirmInput = {
  name: string;
  color: string | null;
  groupSlug?: string | null;
};

export type TaskProjectDialogShare = {
  knownPrincipals?: readonly CollectionSharePrincipal[];
  online?: boolean;
  onSearchPrincipals: (query: string) => Promise<CollectionSharePrincipal[]>;
  onPatchShareWith: (listId: string, shareWith: CollectionShareWith) => Promise<void>;
};

type TaskProjectDialogLabels = {
  createTitle: string;
  editTitle: string;
  nameLabel: string;
  colorLabel: string;
  scopeLabel: string;
  scopePersonal: (ownerLabel: string) => string;
  scopeGroup: (name: string) => string;
  scopeReadOnlyLabel: string;
  changeOwnerConfirmTitle: string;
  changeOwnerConfirmToGroup: (groupName: string) => string;
  changeOwnerConfirmToPersonal: string;
  changeOwnerConfirm: string;
  createButton: string;
  saveButton: string;
  cancel: string;
  shareListSectionTitle: string;
  shareListSectionHint: string;
  shareListAddPlaceholder: string;
  shareListSearchEmpty: string;
  shareListOffline: string;
  removeListShareTitle: string;
  removeListShareConfirm: string;
  removeSharedList: string;
  removeSharedListConfirmTitle: string;
  removeSharedListConfirmDescription: string;
};

type TaskProjectDialogProps = {
  dialog: TaskProjectDialogState;
  groups: TaskProjectGroupOption[];
  personalOwnerLabel: string;
  onClose: () => void;
  onConfirm: (input: TaskProjectDialogConfirmInput) => void;
  labels: TaskProjectDialogLabels;
  contentClassName?: string;
  share?: TaskProjectDialogShare;
  onRemoveShared?: () => void;
};

function editDialogDisplayColor(listId: string, color: string | null): string {
  return taskListDotColor({ id: listId, color });
}

export function taskProjectDialogLabelsFrom(labels: TasksUILabels): TaskProjectDialogLabels {
  return {
    createTitle: labels.newProject,
    editTitle: labels.editList,
    nameLabel: labels.projectNameLabel,
    colorLabel: labels.projectColorLabel,
    scopeLabel: labels.projectScopeLabel,
    scopePersonal: labels.projectScopePersonal,
    scopeGroup: labels.projectScopeGroup,
    scopeReadOnlyLabel: labels.projectScopeReadOnlyLabel,
    changeOwnerConfirmTitle: labels.changeListOwnerConfirmTitle,
    changeOwnerConfirmToGroup: labels.changeListOwnerConfirmToGroup,
    changeOwnerConfirmToPersonal: labels.changeListOwnerConfirmToPersonal,
    changeOwnerConfirm: labels.changeListOwnerConfirm,
    createButton: labels.createProjectButton,
    saveButton: labels.saveProjectButton,
    cancel: labels.cancel,
    shareListSectionTitle: labels.shareListSectionTitle,
    shareListSectionHint: labels.shareListSectionHint,
    shareListAddPlaceholder: labels.shareListAddPlaceholder,
    shareListSearchEmpty: labels.shareListSearchEmpty,
    shareListOffline: labels.shareListOffline,
    removeListShareTitle: labels.removeListShareTitle,
    removeListShareConfirm: labels.removeListShareConfirm,
    removeSharedList: labels.removeSharedList,
    removeSharedListConfirmTitle: labels.removeSharedListConfirmTitle,
    removeSharedListConfirmDescription: labels.removeSharedListConfirmDescription,
  };
}

export function TaskProjectDialog({
  dialog,
  groups,
  personalOwnerLabel,
  onClose,
  onConfirm,
  labels,
  contentClassName,
  share,
  onRemoveShared,
}: TaskProjectDialogProps) {
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(DEFAULT_TASK_LIST_COLOR);
  const [scopeValue, setScopeValue] = useState(PERSONAL_SCOPE_VALUE);
  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false);
  const [confirmOwnerOpen, setConfirmOwnerOpen] = useState(false);
  const open = dialog !== null;
  const isCreate = dialog?.mode === "create";
  const isSharee = dialog?.mode === "edit" && Boolean(dialog.isSharee);
  const showShare = dialog?.mode === "edit" && Boolean(dialog.mayShare) && Boolean(share);
  const canRemoveShared = isSharee && Boolean(onRemoveShared);
  const canChangeOwner = isCreate || (dialog?.mode === "edit" && Boolean(dialog.canChangeOwner));

  useEffect(() => {
    if (!dialog) {
      setConfirmRemoveOpen(false);
      setConfirmOwnerOpen(false);
      return;
    }
    if (dialog.mode === "create") {
      setName("");
      setColor(DEFAULT_TASK_LIST_COLOR);
      setScopeValue(PERSONAL_SCOPE_VALUE);
      return;
    }
    setName(dialog.name);
    setColor(editDialogDisplayColor(dialog.listId, dialog.color));
    setScopeValue(ownerScopeValueFromDirectory(dialog.scope, dialog.groupSlug));
  }, [dialog]);

  const trimmedName = name.trim();
  const selectedColor = color.trim() || DEFAULT_TASK_LIST_COLOR;
  const ownerUnchanged =
    dialog?.mode === "edit" &&
    ownerScopeValueFromDirectory(dialog.scope, dialog.groupSlug) === scopeValue;
  const unchangedEdit =
    dialog?.mode === "edit" &&
    trimmedName === dialog.name.trim() &&
    selectedColor.toLowerCase() ===
      editDialogDisplayColor(dialog.listId, dialog.color).toLowerCase() &&
    ownerUnchanged;
  const canSubmit = Boolean(trimmedName) && (isCreate || !unchangedEdit);
  const ownerTransferPending = dialog?.mode === "edit" && canChangeOwner && !ownerUnchanged;
  const nextOwnerGroupSlug = groupSlugFromOwnerScopeValue(scopeValue);
  const ownerConfirmDescription = nextOwnerGroupSlug
    ? labels.changeOwnerConfirmToGroup(
        groups.find((group) => group.slug === nextOwnerGroupSlug)?.displayName ??
          nextOwnerGroupSlug,
      )
    : labels.changeOwnerConfirmToPersonal;

  const confirmInput = (): TaskProjectDialogConfirmInput => ({
    name: trimmedName,
    color: selectedColor,
    ...(isCreate || canChangeOwner ? { groupSlug: groupSlugFromOwnerScopeValue(scopeValue) } : {}),
  });
  const ownerLabels = {
    label: labels.scopeLabel,
    personal: labels.scopePersonal,
    group: labels.scopeGroup,
    readOnlyLabel: labels.scopeReadOnlyLabel,
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
        <DialogContent className={contentClassName} aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{isCreate ? labels.createTitle : labels.editTitle}</DialogTitle>
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
            <FieldLabelRow label={labels.nameLabel} htmlFor="task-project-name">
              <div className="task-project-dialog__name-color-row">
                <Input
                  id="task-project-name"
                  className="task-project-dialog__name-input"
                  autoFocus
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
                <TaskProjectColorPicker
                  value={selectedColor}
                  onChange={setColor}
                  colorLabel={labels.colorLabel}
                  previewListId={dialog?.mode === "edit" ? dialog.listId : trimmedName || "preview"}
                />
              </div>
            </FieldLabelRow>

            <OwnerScopeField
              id="task-project-scope"
              value={scopeValue}
              onValueChange={setScopeValue}
              groups={groups}
              personalOwnerLabel={personalOwnerLabel}
              labels={ownerLabels}
              disabled={!canChangeOwner}
            />

            {showShare && share && dialog?.mode === "edit" ? (
              <div className="task-project-dialog__share">
                <CollectionShareSection
                  collectionId={dialog.listId}
                  shareWith={dialog.shareWith}
                  knownPrincipals={share.knownPrincipals}
                  online={share.online}
                  dialogClassName={contentClassName}
                  copy={{
                    title: labels.shareListSectionTitle,
                    hint: labels.shareListSectionHint,
                    placeholder: labels.shareListAddPlaceholder,
                    empty: labels.shareListSearchEmpty,
                    offline: labels.shareListOffline,
                    removeTitle: labels.removeListShareTitle,
                    removeConfirm: labels.removeListShareConfirm,
                  }}
                  onSearchPrincipals={share.onSearchPrincipals}
                  onPatchShareWith={share.onPatchShareWith}
                />
              </div>
            ) : null}

            <DialogFooter className="task-project-dialog__footer">
              {canRemoveShared ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="task-project-dialog__remove"
                  onClick={() => setConfirmRemoveOpen(true)}
                >
                  {labels.removeSharedList}
                </Button>
              ) : null}
              <Button type="button" variant="outline" onClick={onClose}>
                {labels.cancel}
              </Button>
              <Button type="submit" disabled={!canSubmit}>
                {isCreate ? labels.createButton : labels.saveButton}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmOwnerOpen} onOpenChange={setConfirmOwnerOpen}>
        <AlertDialogContent className={contentClassName}>
          <AlertDialogHeader>
            <AlertDialogTitle>{labels.changeOwnerConfirmTitle}</AlertDialogTitle>
            <AlertDialogDescription>{ownerConfirmDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{labels.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOwnerOpen(false);
                onConfirm(confirmInput());
              }}
            >
              {labels.changeOwnerConfirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmRemoveOpen} onOpenChange={setConfirmRemoveOpen}>
        <AlertDialogContent className={contentClassName}>
          <AlertDialogHeader>
            <AlertDialogTitle>{labels.removeSharedListConfirmTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {labels.removeSharedListConfirmDescription}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{labels.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmRemoveOpen(false);
                onRemoveShared?.();
              }}
            >
              {labels.removeSharedList}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
