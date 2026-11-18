import { isAppUrlWarning } from "@/admin-core/src/admin-workspace-utils";
import {
  adminSettingsFormToMap,
  buildAdminSettingsFormState,
  mergeStoredSettings,
  type AdminSettingsFormState,
} from "@/admin-core/src/admin-settings-form-utils";
import {
  mailTestSendFeedback,
  normalizeMailTestRecipient,
} from "@/admin-core/src/admin-mail-delivery-test";
import { mutationErrorMessage } from "@/admin-core/src/admin-mutation-feedback";
import type { AdminMutationSliceArgs } from "@/admin-core/src/admin-mutation-slice";

type SettingsShell = AdminMutationSliceArgs<
  | "settingsForm"
  | "setSettingsForm"
  | "setMailDelivery"
  | "setUpdates"
  | "setUpdateLogLines"
  | "applyAdminData"
>;

export function useAdminSettingsMutations({
  operations,
  shell,
  showSuccess,
  showError,
}: SettingsShell) {
  const {
    settingsForm,
    setSettingsForm,
    setMailDelivery,
    setUpdates,
    setUpdateLogLines,
    applyAdminData,
  } = shell;

  const saveSettings = async (patch?: Partial<AdminSettingsFormState>) => {
    if (!operations?.saveSettings) {
      showError("Admin API is not ready yet");
      return;
    }
    const previous = settingsForm;
    const nextForm = patch ? { ...settingsForm, ...patch } : settingsForm;
    if (patch) {
      setSettingsForm(nextForm);
    }
    try {
      const next = await operations.saveSettings(adminSettingsFormToMap(nextForm));
      setSettingsForm(buildAdminSettingsFormState(next));
      setMailDelivery(next.mailDelivery);
      setUpdates(next.updates);
      setUpdateLogLines(next.updateLogLines);
      showSuccess("Admin settings saved");
    } catch (error) {
      if (patch) {
        setSettingsForm(previous);
      }
      showError(mutationErrorMessage(error, "Could not save admin settings"));
    }
  };

  /** Autosave: stores `sent` without a toast (the page shows Saving / Saved); false on failure. */
  const autosaveSettings = async (sent: AdminSettingsFormState): Promise<boolean> => {
    if (!operations?.saveSettings) {
      showError("Admin API is not ready yet");
      return false;
    }
    try {
      const next = await operations.saveSettings(adminSettingsFormToMap(sent));
      const stored = buildAdminSettingsFormState(next);
      setSettingsForm((current) => mergeStoredSettings(current, sent, stored));
      setMailDelivery(next.mailDelivery);
      setUpdates(next.updates);
      setUpdateLogLines(next.updateLogLines);
      return true;
    } catch (error) {
      showError(mutationErrorMessage(error, "Could not save admin settings"));
      return false;
    }
  };

  /** `form`: what the autosave would send now (Admin passes it; fields being typed keep). */
  const clearMailDeliverySmtpPassword = async (form: AdminSettingsFormState = settingsForm) => {
    if (!operations?.saveSettings) {
      showError("Admin API is not ready yet");
      return;
    }
    try {
      const sent = { ...form, mailDeliverySmtpPassword: "" };
      const next = await operations.saveSettings(adminSettingsFormToMap(sent), {
        clearSmtpPassword: true,
      });
      const stored = buildAdminSettingsFormState(next);
      setSettingsForm((current) => mergeStoredSettings(current, sent, stored));
      setMailDelivery(next.mailDelivery);
      showSuccess("Stored SMTP password cleared");
    } catch (error) {
      showError(mutationErrorMessage(error, "Could not clear SMTP password"));
    }
  };

  const clearTurnSecret = async (form: AdminSettingsFormState = settingsForm) => {
    if (!operations?.saveSettings) {
      showError("Admin API is not ready yet");
      return;
    }
    try {
      const sent = { ...form, turnSecret: "" };
      const next = await operations.saveSettings(adminSettingsFormToMap(sent), {
        clearTurnSecret: true,
      });
      const stored = buildAdminSettingsFormState(next);
      setSettingsForm((current) => mergeStoredSettings(current, sent, stored));
      showSuccess("Stored TURN secret cleared");
    } catch (error) {
      showError(mutationErrorMessage(error, "Could not clear TURN secret"));
    }
  };

  const sendMailDeliveryTest = async (to: string) => {
    const recipient = normalizeMailTestRecipient(to);
    if (!recipient.ok) {
      showError(recipient.message);
      return false;
    }
    if (!operations?.sendMailDeliveryTest) {
      showError("Admin API is not ready yet");
      return false;
    }
    try {
      const next = await operations.sendMailDeliveryTest({ to: recipient.recipient });
      applyAdminData(next);
      const feedback = mailTestSendFeedback(next.mailDelivery.lastTestSend);
      if (feedback.kind === "success") {
        showSuccess(feedback.message);
      } else {
        showError(feedback.message);
      }
      return true;
    } catch (error) {
      showError(mutationErrorMessage(error, "Could not send a test email"));
      return false;
    }
  };

  const useThisAddress = async (url: string): Promise<boolean> => {
    if (!operations?.setAppUrl) {
      showError("Admin API is not ready yet");
      return false;
    }
    try {
      const next = await operations.setAppUrl(url);
      applyAdminData(next);
      if (next.securityWarnings.some(isAppUrlWarning)) {
        showError("The address was saved, but the server still reports APP_URL as unset.");
        return false;
      }
      showSuccess("Site address saved");
      return true;
    } catch (error) {
      showError(mutationErrorMessage(error, "Could not save the site address"));
      return false;
    }
  };

  return {
    saveSettings,
    autosaveSettings,
    clearMailDeliverySmtpPassword,
    clearTurnSecret,
    sendMailDeliveryTest,
    useThisAddress,
  };
}
