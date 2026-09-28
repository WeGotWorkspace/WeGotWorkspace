import {
  adminSettingsFormToMap,
  buildAdminSettingsFormState,
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

  const clearMailDeliverySmtpPassword = async () => {
    if (!operations?.saveSettings) {
      showError("Admin API is not ready yet");
      return;
    }
    try {
      const next = await operations.saveSettings(
        adminSettingsFormToMap({
          ...settingsForm,
          mailDeliverySmtpPassword: "",
        }),
        { clearSmtpPassword: true },
      );
      setSettingsForm(buildAdminSettingsFormState(next));
      setMailDelivery(next.mailDelivery);
      showSuccess("Stored SMTP password cleared");
    } catch (error) {
      showError(mutationErrorMessage(error, "Could not clear SMTP password"));
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

  return { saveSettings, clearMailDeliverySmtpPassword, sendMailDeliveryTest };
}
