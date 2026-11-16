import { useEffect, useRef, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Check } from "lucide-react";
import { useForm, type Resolver } from "react-hook-form";
import { useAppToast } from "@/hooks/use-app-toast";
import { wgwCompleteLogoutNavigation } from "@/lib/api/wgw/http";
import { countDiscardedUnsyncedChanges } from "@/lib/offline/core/offline-wipe";
import {
  settingsDisplayNameFormSchema,
  settingsDisplayNameRequest,
  settingsEmailFormSchemaFor,
  settingsEmailRequest,
  settingsPasswordFormSchema,
  settingsPasswordRequest,
  type SettingsDisplayNameFormValues,
  type SettingsEmailFormValues,
  type SettingsPasswordFormValues,
} from "@/settings-core/src/settings-profile-form-schema";
import type { SettingsAPIOperations, SettingsUser } from "@/lib/models/settings-types";

export type SettingsProfileUnsyncedDiscard = {
  description: string;
  confirm: () => void;
  cancel: () => void;
};

type DiscardPrompt = {
  description: string;
  resolve: (accepted: boolean) => void;
};

function unsyncedDiscardWarning(count: number | null): string {
  if (count === null) return "Unsynced changes on this device will be discarded.";
  if (count === 1) return "This device has 1 unsynced change. It will be discarded.";
  return `This device has ${count} unsynced changes. They will be discarded.`;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/** The API answers a wrong current password with 403. */
function isWrongCurrentPassword(error: unknown): boolean {
  return (error as { status?: unknown } | null)?.status === 403;
}

/**
 * Settings › Profile. The display name saves itself, as the app settings do (the page's
 * Saving / Saved tag). Email and password change in their own dialogs: each asks for the
 * current password. A new password signs this device out; when the device holds unsynced
 * changes, the user confirms first that they will be discarded.
 */
export function useSettingsProfileForm({
  user,
  operations,
  countUnsyncedChanges = countDiscardedUnsyncedChanges,
}: {
  user: SettingsUser;
  operations?: SettingsAPIOperations;
  countUnsyncedChanges?: () => Promise<number>;
}) {
  const { showError, showSuccess } = useAppToast();
  // The page loads the user once; after a change the API's answer is the saved state.
  const [savedEmail, setSavedEmail] = useState(user.email);
  const savedEmailRef = useRef(user.email);
  savedEmailRef.current = savedEmail;

  useEffect(() => {
    setSavedEmail(user.email);
  }, [user.email]);

  // ---- Display name (autosave) ----
  const displayNameForm = useForm<SettingsDisplayNameFormValues>({
    resolver: zodResolver(settingsDisplayNameFormSchema),
    defaultValues: { displayName: user.displayName },
    mode: "onChange",
  });

  useEffect(() => {
    // A reload of the user must not overwrite what the user is typing.
    if (displayNameForm.formState.isDirty) return;
    displayNameForm.reset({ displayName: user.displayName });
  }, [user.displayName, displayNameForm]);

  const saveDisplayName = async () => {
    if (!(await displayNameForm.trigger())) return;
    const values = displayNameForm.getValues();
    try {
      await operations?.saveProfile(settingsDisplayNameRequest(values));
    } catch (error) {
      showError(errorMessage(error, "Could not save your display name"));
      return;
    }
    // Typing on while the save ran leaves the form dirty: the next autosave sends that.
    if (displayNameForm.getValues().displayName === values.displayName) {
      displayNameForm.reset(values);
    }
  };

  // ---- Email (dialog) ----
  const emailResolver: Resolver<SettingsEmailFormValues> = (values, context, options) =>
    zodResolver(settingsEmailFormSchemaFor(savedEmailRef.current))(values, context, options);
  const emailForm = useForm<SettingsEmailFormValues>({
    resolver: emailResolver,
    defaultValues: { email: user.email, currentPassword: "" },
  });
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);

  const openEmailDialog = () => {
    emailForm.reset({ email: savedEmail, currentPassword: "" });
    setEmailDialogOpen(true);
  };

  const changeEmail = emailForm.handleSubmit(async (values) => {
    try {
      const data = await operations?.saveProfile(settingsEmailRequest(values));
      setSavedEmail(data?.user.email ?? values.email.trim());
      setEmailDialogOpen(false);
      showSuccess("Email changed", { icon: <Check className="size-4" /> });
    } catch (error) {
      if (isWrongCurrentPassword(error)) {
        emailForm.setError("currentPassword", { message: "Current password is incorrect" });
        return;
      }
      showError(errorMessage(error, "Could not change your email"));
    }
  });

  // ---- Password (dialog) ----
  const passwordForm = useForm<SettingsPasswordFormValues>({
    resolver: zodResolver(settingsPasswordFormSchema),
    defaultValues: { newPassword: "", currentPassword: "" },
  });
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);

  const openPasswordDialog = () => {
    passwordForm.reset({ newPassword: "", currentPassword: "" });
    setPasswordDialogOpen(true);
  };

  const [discardPrompt, setDiscardPrompt] = useState<DiscardPrompt | null>(null);
  const discardPromptRef = useRef<DiscardPrompt | null>(null);
  const confirmingDiscard = useRef(false);
  const settleDiscardRef = useRef<(accepted: boolean) => void>(() => {});

  function settleDiscard(accepted: boolean) {
    const current = discardPromptRef.current;
    discardPromptRef.current = null;
    confirmingDiscard.current = false;
    setDiscardPrompt(null);
    current?.resolve(accepted);
  }
  settleDiscardRef.current = settleDiscard;

  useEffect(() => {
    return () => {
      settleDiscardRef.current(false);
    };
  }, []);

  function askToDiscardUnsyncedChanges(count: number | null): Promise<boolean> {
    return new Promise((resolve) => {
      const prompt = { description: unsyncedDiscardWarning(count), resolve };
      discardPromptRef.current = prompt;
      setDiscardPrompt(prompt);
    });
  }

  const changePassword = passwordForm.handleSubmit(async (values) => {
    if (confirmingDiscard.current) return;
    confirmingDiscard.current = true;
    let unsyncedCount: number | null = 0;
    try {
      unsyncedCount = await countUnsyncedChanges();
    } catch {
      unsyncedCount = null;
    }
    if (unsyncedCount === null || unsyncedCount > 0) {
      const accepted = await askToDiscardUnsyncedChanges(unsyncedCount);
      if (!accepted) return;
    } else {
      confirmingDiscard.current = false;
    }
    try {
      await operations?.saveProfile(settingsPasswordRequest(values));
    } catch (error) {
      if (isWrongCurrentPassword(error)) {
        passwordForm.setError("currentPassword", { message: "Current password is incorrect" });
        return;
      }
      showError(errorMessage(error, "Could not change your password"));
      return;
    }
    setPasswordDialogOpen(false);
    showSuccess("Password changed. Sign in again.", { icon: <Check className="size-4" /> });
    const navigation = await wgwCompleteLogoutNavigation();
    if (navigation === "member_login") {
      window.location.assign("/login");
    }
  });

  const unsyncedDiscard: SettingsProfileUnsyncedDiscard | null = discardPrompt
    ? {
        description: discardPrompt.description,
        confirm: () => settleDiscard(true),
        cancel: () => settleDiscard(false),
      }
    : null;

  return {
    username: user.username,
    email: savedEmail,
    displayNameForm,
    saveDisplayName,
    emailForm,
    emailDialogOpen,
    openEmailDialog,
    setEmailDialogOpen,
    changeEmail,
    passwordForm,
    passwordDialogOpen,
    openPasswordDialog,
    setPasswordDialogOpen,
    changePassword,
    unsyncedDiscard,
  };
}

export type SettingsProfileFormController = ReturnType<typeof useSettingsProfileForm>;
