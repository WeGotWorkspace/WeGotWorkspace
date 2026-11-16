import { useId } from "react";
import { KeyRound } from "lucide-react";
import { Button, buttonVariants } from "@/button/src/button";
import { Input } from "@/ui/input";
import { useFormAutosave } from "@/hooks/use-form-autosave";
import { SettingsPaneCard } from "@/settings-core/src/settings-pane-card";
import type { SettingsControllerState } from "@/settings-core/src/use-settings-controller";
import { SETTINGS_PASSWORD_MIN_LENGTH } from "@/settings-core/src/settings-profile-form-schema";
import { Form } from "@/ui/form";
import { FieldLabelRow } from "@/ui/field-label-row";
import { FormTextField } from "@/ui/form-text-field";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog";
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

/** Stands in for the password in its read-only row; the real one is never loaded. */
const PASSWORD_MASK = "••••••••••";

export function SettingsProfilePane({ profile }: SettingsProfilePaneProps) {
  // Here, not in the controller: the save tag listens inside the Settings page, below it.
  useFormAutosave(profile.displayNameForm, profile.saveDisplayName);
  const usernameId = useId();
  const emailId = useId();
  const passwordId = useId();

  return (
    <>
      <SettingsPaneCard>
        <FieldLabelRow
          layout="inline"
          fill
          label="Username"
          description="Your sign-in name. It cannot be changed."
          readOnly
          htmlFor={usernameId}
        >
          <Input id={usernameId} value={profile.username} readOnly />
        </FieldLabelRow>
        <Form {...profile.displayNameForm}>
          <FormTextField
            layout="inline"
            name="displayName"
            label="Display name"
            description="How others see you"
            autoComplete="name"
          />
        </Form>
        <FieldLabelRow
          layout="inline"
          fill
          label="Email"
          description="For account mail and invitations"
          htmlFor={emailId}
        >
          <div className="settings-profile-pane__control">
            <Input id={emailId} value={profile.email} readOnly />
            <Button variant="outline" onClick={profile.openEmailDialog}>
              Change
            </Button>
          </div>
        </FieldLabelRow>
      </SettingsPaneCard>

      <SettingsPaneCard title="Security" icon={<KeyRound aria-hidden />}>
        <FieldLabelRow
          layout="inline"
          fill
          label="Password"
          description="Changing it signs you out on this device"
          htmlFor={passwordId}
        >
          <div className="settings-profile-pane__control">
            {/* Plain text, not type=password: there is nothing to reveal. */}
            <Input id={passwordId} value={PASSWORD_MASK} readOnly aria-label="Password (hidden)" />
            <Button variant="outline" onClick={profile.openPasswordDialog}>
              Change
            </Button>
          </div>
        </FieldLabelRow>
      </SettingsPaneCard>

      <ChangeEmailDialog profile={profile} />
      <ChangePasswordDialog profile={profile} />
      <UnsyncedDiscardDialog profile={profile} />
    </>
  );
}

function ChangeEmailDialog({ profile }: SettingsProfilePaneProps) {
  const { emailForm, emailDialogOpen, setEmailDialogOpen, changeEmail } = profile;
  const busy = emailForm.formState.isSubmitting;
  return (
    <Dialog open={emailDialogOpen} onOpenChange={(open) => !busy && setEmailDialogOpen(open)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change email</DialogTitle>
          <DialogDescription>Enter your new address and your current password.</DialogDescription>
        </DialogHeader>
        <Form {...emailForm}>
          <form onSubmit={changeEmail} noValidate>
            <FormTextField
              layout="inline"
              name="email"
              label="New email"
              type="email"
              autoComplete="email"
              autoFocus
            />
            <FormTextField
              layout="inline"
              name="currentPassword"
              label="Current password"
              variant="password"
              autoComplete="current-password"
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => setEmailDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={busy}>
                Change email
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function ChangePasswordDialog({ profile }: SettingsProfilePaneProps) {
  const { passwordForm, passwordDialogOpen, setPasswordDialogOpen, changePassword } = profile;
  const busy = passwordForm.formState.isSubmitting;
  return (
    <Dialog open={passwordDialogOpen} onOpenChange={(open) => !busy && setPasswordDialogOpen(open)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change password</DialogTitle>
          <DialogDescription>
            You are signed out on this device afterwards and sign in with the new password.
          </DialogDescription>
        </DialogHeader>
        <Form {...passwordForm}>
          <form onSubmit={changePassword} noValidate>
            <FormTextField
              layout="inline"
              name="currentPassword"
              label="Current password"
              variant="password"
              autoComplete="current-password"
              autoFocus
            />
            <FormTextField
              layout="inline"
              name="newPassword"
              label="New password"
              variant="password"
              autoComplete="new-password"
              placeholder={`At least ${SETTINGS_PASSWORD_MIN_LENGTH} characters`}
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => setPasswordDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={busy}>
                Change password
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function UnsyncedDiscardDialog({ profile }: SettingsProfilePaneProps) {
  const { unsyncedDiscard } = profile;
  return (
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
  );
}
