import { useEffect, useRef, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Check } from "lucide-react";
import { useForm } from "react-hook-form";
import { useRunWithAppToast } from "@/hooks/use-run-with-app-toast";
import { wgwCompleteLogoutNavigation } from "@/lib/api/wgw/http";
import { countDiscardedUnsyncedChanges } from "@/lib/offline/core/offline-wipe";
import {
  settingsProfileFormSchemaFor,
  settingsProfileFormToRequest,
  type SettingsProfileFormValues,
} from "@/settings-core/src/settings-profile-form-schema";
import type { SettingsAPIOperations, SettingsUser } from "@/settings-core/src/settings-types";

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

export function useSettingsProfileForm({
  user,
  operations,
  countUnsyncedChanges = countDiscardedUnsyncedChanges,
}: {
  user: SettingsUser;
  operations?: SettingsAPIOperations;
  countUnsyncedChanges?: () => Promise<number>;
}) {
  const runWithAppToast = useRunWithAppToast();
  const profileForm = useForm<SettingsProfileFormValues>({
    resolver: zodResolver(settingsProfileFormSchemaFor(user.email)),
    defaultValues: {
      displayName: user.displayName,
      email: user.email,
      newPassword: "",
      confirmPassword: "",
      currentPassword: "",
    },
    mode: "onSubmit",
  });
  const [discardPrompt, setDiscardPrompt] = useState<DiscardPrompt | null>(null);
  const discardPromptRef = useRef<DiscardPrompt | null>(null);
  const confirmingDiscard = useRef(false);

  const { reset } = profileForm;

  useEffect(() => {
    reset({
      displayName: user.displayName,
      email: user.email,
      newPassword: "",
      confirmPassword: "",
      currentPassword: "",
    });
  }, [user.displayName, user.email, reset]);

  function settleDiscard(accepted: boolean) {
    const current = discardPromptRef.current;
    discardPromptRef.current = null;
    confirmingDiscard.current = false;
    setDiscardPrompt(null);
    current?.resolve(accepted);
  }

  function askToDiscardUnsyncedChanges(count: number | null): Promise<boolean> {
    return new Promise((resolve) => {
      const prompt = { description: unsyncedDiscardWarning(count), resolve };
      discardPromptRef.current = prompt;
      setDiscardPrompt(prompt);
    });
  }

  const saveProfile = profileForm.handleSubmit(async (values) => {
    const requestBody = settingsProfileFormToRequest(values, user.email);
    const passwordChanged =
      typeof requestBody.password === "string" && requestBody.password.length > 0;
    if (passwordChanged) {
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
    }
    const saved = await runWithAppToast(
      async () => {
        await operations?.saveProfile(requestBody);
        if (!passwordChanged) {
          reset({
            ...values,
            newPassword: "",
            confirmPassword: "",
            currentPassword: "",
          });
        }
        return passwordChanged ? "password-changed" : "saved";
      },
      {
        success: passwordChanged ? "Password changed. Sign in again." : "Profile saved",
        successOptions: { icon: <Check className="size-4" /> },
        mapError: (error) => (error instanceof Error ? error.message : "Could not save profile"),
      },
    );
    if (saved !== "password-changed") return;
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
    form: profileForm,
    saveProfile,
    unsyncedDiscard,
  };
}

export type SettingsProfileFormController = ReturnType<typeof useSettingsProfileForm>;
