import { useEffect } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Check } from "lucide-react";
import { useForm } from "react-hook-form";
import { useRunWithAppToast } from "@/hooks/use-run-with-app-toast";
import {
  settingsProfileFormSchemaFor,
  settingsProfileFormToRequest,
  type SettingsProfileFormValues,
} from "@/settings-core/src/settings-profile-form-schema";
import type { SettingsAPIOperations, SettingsUser } from "@/settings-core/src/settings-types";

export function useSettingsProfileForm({
  user,
  operations,
}: {
  user: SettingsUser;
  operations?: SettingsAPIOperations;
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

  const saveProfile = profileForm.handleSubmit(async (values) => {
    const requestBody = settingsProfileFormToRequest(values, user.email);
    await runWithAppToast(
      async () => {
        await operations?.saveProfile(requestBody);
        reset({
          ...values,
          newPassword: "",
          confirmPassword: "",
          currentPassword: "",
        });
      },
      {
        success: "Profile saved",
        successOptions: { icon: <Check className="size-4" /> },
        mapError: (error) => (error instanceof Error ? error.message : "Could not save profile"),
      },
    );
  });

  return {
    username: user.username,
    form: profileForm,
    saveProfile,
  };
}

export type SettingsProfileFormController = ReturnType<typeof useSettingsProfileForm>;
