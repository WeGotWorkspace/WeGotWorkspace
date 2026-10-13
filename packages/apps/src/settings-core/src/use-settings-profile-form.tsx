import { useEffect } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Check } from "lucide-react";
import { useForm } from "react-hook-form";
import { useRunWithAppToast } from "@/hooks/use-run-with-app-toast";
import { wgwCompleteLogoutNavigation } from "@/lib/api/wgw/http";
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
    const passwordChanged =
      typeof requestBody.password === "string" && requestBody.password.length > 0;
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

  return {
    username: user.username,
    form: profileForm,
    saveProfile,
  };
}

export type SettingsProfileFormController = ReturnType<typeof useSettingsProfileForm>;
