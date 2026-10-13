import { useId } from "react";
import { Input } from "@/ui/input";
import { Card } from "@/card/src/card";
import { settingsWorkspacePaneClasses } from "@/settings-core/src/settings-workspace.styles";
import type { SettingsControllerState } from "@/settings-core/src/use-settings-controller";
import { buttonVariants } from "@/ui/button";
import { Form } from "@/ui/form";
import { FieldLabelRow } from "@/ui/field-label-row";
import { FormSaveActionRow } from "@/ui/form-save-action-row";
import { FormTextField } from "@/ui/form-text-field";
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

export type SettingsProfilePaneProps = {
  profile: SettingsControllerState["profile"];
};

export function SettingsProfilePane({ profile }: SettingsProfilePaneProps) {
  const { form, username, saveProfile, unsyncedDiscard } = profile;
  const usernameId = useId();
  const [newPasswordWatch, confirmPasswordWatch] = form.watch(["newPassword", "confirmPassword"]);
  const emailDirty = Boolean(form.formState.dirtyFields.email);
  const passwordActive = Boolean(newPasswordWatch || confirmPasswordWatch);
  const showCurrentPassword = emailDirty || passwordActive;

  const identityDisabled =
    !(form.formState.dirtyFields.displayName || form.formState.dirtyFields.email) &&
    !newPasswordWatch &&
    !confirmPasswordWatch;

  const passwordDisabled = !newPasswordWatch && !confirmPasswordWatch;

  return (
    <Form {...form}>
      <Card title="Identity">
        <FieldLabelRow label="Username" readOnly htmlFor={usernameId}>
          <Input id={usernameId} value={username} readOnly />
        </FieldLabelRow>
        <FormTextField
          {...settingsWorkspacePaneClasses.formTextField}
          name="displayName"
          label="Display name"
        />
        <FormTextField
          {...settingsWorkspacePaneClasses.formTextField}
          name="email"
          label="Email"
          type="email"
        />
        {showCurrentPassword ? (
          <FormTextField
            {...settingsWorkspacePaneClasses.formTextField}
            name="currentPassword"
            label="Current password"
            variant="password"
            autoComplete="current-password"
          />
        ) : null}
        <FormSaveActionRow
          className={settingsWorkspacePaneClasses.saveActionRow}
          label="Save changes"
          disabled={identityDisabled}
          onSave={saveProfile}
        />
      </Card>

      <Card title="Password">
        <FormTextField
          {...settingsWorkspacePaneClasses.formTextField}
          name="newPassword"
          label="New password"
          variant="password"
          placeholder="At least 8 characters"
        />
        <FormTextField
          {...settingsWorkspacePaneClasses.formTextField}
          name="confirmPassword"
          label="Confirm password"
          variant="password"
        />
        <FormSaveActionRow
          className={settingsWorkspacePaneClasses.saveActionRow}
          label="Set password"
          disabled={passwordDisabled}
          onSave={saveProfile}
        />
      </Card>
      <AlertDialog
        open={unsyncedDiscard !== null}
        onOpenChange={(open) => {
          if (!open) unsyncedDiscard?.cancel();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsynced changes?</AlertDialogTitle>
            <AlertDialogDescription>{unsyncedDiscard?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              onClick={(event) => {
                event.preventDefault();
                unsyncedDiscard?.confirm();
              }}
            >
              Change password
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Form>
  );
}
