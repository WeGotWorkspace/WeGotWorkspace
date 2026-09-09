import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SettingsUIData } from "@/settings-core/src/settings-types";
import { useSettingsProfileForm } from "@/settings-core/src/use-settings-profile-form";

vi.mock("@/hooks/use-run-with-app-toast", () => ({
  useRunWithAppToast: () => async (work: () => Promise<unknown>) => work(),
}));

const baseUser = {
  username: "alice",
  displayName: "Alice Example",
  email: "alice@example.com",
};

function createSaveProfileMock() {
  const nextData = {
    user: { ...baseUser, displayName: "Alice Updated" },
    mail: { imapUsername: "alice@example.com", imapHasPassword: true },
    mailServer: {
      imapHost: "imap.example.com",
      imapPort: 993,
      imapSecurity: "ssl",
      smtpHost: "smtp.example.com",
      smtpPort: 587,
      smtpSecurity: "starttls",
    },
    groups: [],
    logoutUrl: "/logout",
    mcpEnabled: true,
  } satisfies SettingsUIData;

  return vi.fn().mockResolvedValue(nextData);
}

describe("useSettingsProfileForm", () => {
  it("calls saveProfile with OpenAPI-shaped identity fields", async () => {
    const saveProfile = createSaveProfileMock();
    const saveMail = vi.fn();

    const { result } = renderHook(() =>
      useSettingsProfileForm({
        user: baseUser,
        operations: { saveProfile, saveMail },
      }),
    );

    act(() => {
      result.current.form.setValue("displayName", "Alice Updated", { shouldDirty: true });
    });

    await act(async () => {
      await result.current.saveProfile();
    });

    await waitFor(() => {
      expect(saveProfile).toHaveBeenCalledWith({
        displayName: "Alice Updated",
        email: "alice@example.com",
      });
    });
  });

  it("includes password in the request when a new password is set", async () => {
    const saveProfile = createSaveProfileMock();
    const saveMail = vi.fn();

    const { result } = renderHook(() =>
      useSettingsProfileForm({
        user: baseUser,
        operations: { saveProfile, saveMail },
      }),
    );

    act(() => {
      result.current.form.setValue("newPassword", "hunter2hunter", { shouldDirty: true });
      result.current.form.setValue("confirmPassword", "hunter2hunter", { shouldDirty: true });
    });

    await act(async () => {
      await result.current.saveProfile();
    });

    await waitFor(() => {
      expect(saveProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          displayName: "Alice Example",
          email: "alice@example.com",
          password: "hunter2hunter",
        }),
      );
    });
  });
});
