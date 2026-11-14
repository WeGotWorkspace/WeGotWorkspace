import type { ProjectDialogLabels } from "@/project-dialog/src/project-dialog";
import type { TasksUILabels } from "@/tasks-core/src/tasks-labels";

/** Tasks wording for the shared project dialog. */
export function taskProjectDialogLabelsFrom(labels: TasksUILabels): ProjectDialogLabels {
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
    deleteList: labels.deleteList,
    deleteListConfirmTitle: labels.deleteListConfirmTitle,
    deleteListConfirmDescription: labels.deleteListConfirmDescription,
    delete: labels.delete,
  };
}
