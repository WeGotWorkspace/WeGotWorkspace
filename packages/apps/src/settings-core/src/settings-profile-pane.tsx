import { useId } from "react";
import { Input } from "@/ui/input";
import { Card } from "@/card/src/card";
import { settingsWorkspacePaneClasses } from "@/settings-core/src/settings-workspace.styles";
import type { SettingsControllerState } from "@/settings-core/src/use-settings-controller";
import { Form } from "@/ui/form";
import { FieldLabelRow } from "@/ui/field-label-row";
import { FormSaveActionRow } from "@/ui/form-save-action-row";
import { FormTextField } from "@/ui/form-text-field";

export type SettingsProfilePaneProps = {
  profile: SettingsControllerState["profile"];
};

export function SettingsProfilePane({ profile }: SettingsProfilePaneProps) {
  const { form, username, saveProfile } = profile;
  const usernameId = useId();
  const [newPasswordWatch, confirmPasswordWatch] = form.watch(["newPassword", "confirmPassword"]);

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
    </Form>
  );
}
