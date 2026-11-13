import { useId } from "react";
import { Input } from "@/ui/input";
import { SettingsPaneCard } from "@/settings-core/src/settings-pane-card";
import type { SettingsControllerState } from "@/settings-core/src/use-settings-controller";
import { buttonVariants } from "@/button/src/button";
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
      <SettingsPaneCard title="Identity">
        <FieldLabelRow
          layout="inline"
          fill
          label="Username"
          description="Your sign-in name. It cannot be changed."
          readOnly
          htmlFor={usernameId}
        >
          <Input id={usernameId} value={username} readOnly />
        </FieldLabelRow>
        <FormTextField
          layout="inline"
          name="displayName"
          label="Display name"
          description="How others see you"
        />
        <FormTextField layout="inline" name="email" label="Email" type="email" />
        {showCurrentPassword ? (
          <FormTextField
            layout="inline"
            name="currentPassword"
            label="Current password"
            description="Needed to change your email or password"
            variant="password"
            autoComplete="current-password"
          />
        ) : null}
        <FormSaveActionRow label="Save changes" disabled={identityDisabled} onSave={saveProfile} />
      </SettingsPaneCard>

      <SettingsPaneCard title="Password">
        <FormTextField
          layout="inline"
          name="newPassword"
          label="New password"
          variant="password"
          placeholder="At least 8 characters"
        />
        <FormTextField
          layout="inline"
          name="confirmPassword"
          label="Confirm password"
          variant="password"
        />
        <FormSaveActionRow label="Set password" disabled={passwordDisabled} onSave={saveProfile} />
      </SettingsPaneCard>
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
