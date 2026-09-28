import { useState } from "react";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AppToastApi } from "@/hooks/use-app-toast";
import { buildAdminSettingsFormState } from "@/admin-core/src/admin-settings-form-utils";
import type { AdminAPIOperations, AdminUIData } from "@/admin-core/src/admin-types";
import { useAdminSettingsMutations } from "@/admin-core/src/use-admin-settings-mutations";
import { createAdminAppBootstrap } from "@/lib/api/mock/admin-bootstrap";

function toasts() {
  return {
    showSuccess: vi.fn() as AppToastApi["showSuccess"],
    showError: vi.fn() as AppToastApi["showError"],
  };
}

function renderSettings(operations?: Partial<AdminAPIOperations>) {
  const toast = toasts();
  const data = createAdminAppBootstrap().data;
  const view = renderHook(() => {
    const [settingsForm, setSettingsForm] = useState(() => buildAdminSettingsFormState(data));
    const [mailDelivery, setMailDelivery] = useState(data.mailDelivery);
    const [updates, setUpdates] = useState(data.updates);
    const [updateLogLines, setUpdateLogLines] = useState(data.updateLogLines);
    const applyAdminData = (next: AdminUIData) => {
      setSettingsForm(buildAdminSettingsFormState(next));
      setMailDelivery(next.mailDelivery);
      setUpdates(next.updates);
      setUpdateLogLines(next.updateLogLines);
    };
    const actions = useAdminSettingsMutations({
      operations: operations as AdminAPIOperations | undefined,
      showSuccess: toast.showSuccess,
      showError: toast.showError,
      shell: {
        settingsForm,
        setSettingsForm,
        setMailDelivery,
        setUpdates,
        setUpdateLogLines,
        applyAdminData,
      },
    });
    return { actions, settingsForm, mailDelivery, updates, updateLogLines };
  });
  return { ...view, ...toast, data };
}

describe("useAdminSettingsMutations", () => {
  it("reports that the admin API is missing", async () => {
    const { result, showError } = renderSettings();
    await act(async () => {
      await result.current.actions.saveSettings();
      await result.current.actions.clearMailDeliverySmtpPassword();
      expect(await result.current.actions.sendMailDeliveryTest("ops@example.test")).toBe(false);
    });
    expect(showError).toHaveBeenCalledWith("Admin API is not ready yet");
  });

  it("rolls a settings patch back when save fails", async () => {
    const saveSettings = vi.fn().mockRejectedValue(new Error("rejected"));
    const { result, showError } = renderSettings({ saveSettings });
    const before = result.current.settingsForm.mcpEnabled;

    await act(async () => {
      await result.current.actions.saveSettings({ mcpEnabled: !before });
    });

    expect(result.current.settingsForm.mcpEnabled).toBe(before);
    expect(showError).toHaveBeenCalledWith("rejected");
  });

  it("stores the saved snapshot and the clear-password flag", async () => {
    const data = createAdminAppBootstrap().data;
    const saved = {
      ...data,
      mcp: { ...data.mcp, enabled: true },
      updates: { ...data.updates, installedVersion: "9.9.9" },
      updateLogLines: ["saved"],
    };
    const saveSettings = vi.fn().mockResolvedValue(saved);
    const { result, showSuccess } = renderSettings({ saveSettings });

    await act(async () => {
      await result.current.actions.saveSettings({ mcpEnabled: true });
    });

    expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({ mcp_enabled: true }));
    expect(result.current.settingsForm.mcpEnabled).toBe(true);
    expect(result.current.updates.installedVersion).toBe("9.9.9");
    expect(result.current.updateLogLines).toEqual(["saved"]);
    expect(showSuccess).toHaveBeenCalledWith("Admin settings saved");

    const cleared = {
      ...saved,
      updates: { ...saved.updates, installedVersion: "should-stay" },
    };
    saveSettings.mockResolvedValue(cleared);
    await act(async () => {
      await result.current.actions.clearMailDeliverySmtpPassword();
    });
    expect(saveSettings).toHaveBeenLastCalledWith(expect.any(Object), { clearSmtpPassword: true });
    expect(result.current.updates.installedVersion).toBe("9.9.9");
    expect(showSuccess).toHaveBeenCalledWith("Stored SMTP password cleared");
  });

  it("returns true after a rejected transport result and false when send throws", async () => {
    const data = createAdminAppBootstrap().data;
    const sendMailDeliveryTest = vi
      .fn()
      .mockResolvedValueOnce({
        ...data,
        mailDelivery: {
          ...data.mailDelivery,
          lastTestSend: {
            accepted: false,
            status: "auth",
            transport: "smtp",
            at: "2026-09-25T00:00:00.000Z",
            message: "auth failed",
          },
        },
      })
      .mockRejectedValueOnce(new Error("offline"));
    const { result, showError } = renderSettings({ sendMailDeliveryTest });

    await act(async () => {
      expect(await result.current.actions.sendMailDeliveryTest("  nope  ")).toBe(false);
      expect(await result.current.actions.sendMailDeliveryTest("ops@example.test")).toBe(true);
      expect(await result.current.actions.sendMailDeliveryTest("ops@example.test")).toBe(false);
    });

    expect(sendMailDeliveryTest).toHaveBeenCalledWith({ to: "ops@example.test" });
    expect(showError).toHaveBeenCalledWith("A recipient email is required");
    expect(showError).toHaveBeenCalledWith("auth failed");
    expect(showError).toHaveBeenCalledWith("offline");
  });
});
