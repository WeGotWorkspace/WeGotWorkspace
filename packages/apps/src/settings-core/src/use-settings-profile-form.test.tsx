import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SettingsUIData } from "@/lib/models/settings-types";
import { useSettingsProfileForm } from "@/settings-core/src/use-settings-profile-form";

const { completeLogout, countUnsynced, toast } = vi.hoisted(() => ({
  completeLogout: vi.fn(async () => "member_login" as const),
  countUnsynced: vi.fn(async () => 0),
  toast: { show: vi.fn(), dismiss: vi.fn(), showSuccess: vi.fn(), showError: vi.fn() },
}));

vi.mock("@/hooks/use-app-toast", () => ({
  useAppToast: () => toast,
}));

vi.mock("@/lib/api/wgw/http", () => ({
  wgwCompleteLogoutNavigation: completeLogout,
}));

vi.mock("@/lib/offline/core/offline-wipe", () => ({
  countDiscardedUnsyncedChanges: countUnsynced,
}));

const baseUser = {
  username: "alice",
  displayName: "Alice Example",
  email: "alice@example.com",
};

function createSaveProfileMock() {
  const nextData = {
    user: { ...baseUser, displayName: "Alice Updated" },
    groups: [],
    logoutUrl: "/logout",
    mcpEnabled: true,
  } satisfies SettingsUIData;

  return vi.fn().mockResolvedValue(nextData);
}

describe("useSettingsProfileForm", () => {
  beforeEach(() => {
    completeLogout.mockClear();
    toast.showSuccess.mockClear();
    toast.showError.mockClear();
    countUnsynced.mockReset();
    countUnsynced.mockResolvedValue(0);
  });

  it("saves only the display name", async () => {
    const saveProfile = createSaveProfileMock();

    const { result } = renderHook(() =>
      useSettingsProfileForm({
        user: baseUser,
        operations: { saveProfile },
      }),
    );

    act(() => {
      result.current.displayNameForm.setValue("displayName", "Alice Updated", {
        shouldDirty: true,
      });
    });

    await act(async () => {
      await result.current.saveDisplayName();
    });

    await waitFor(() => {
      expect(saveProfile).toHaveBeenCalledWith({
        displayName: "Alice Updated",
      });
    });
    expect(result.current.displayNameForm.formState.isDirty).toBe(false);
    expect(completeLogout).not.toHaveBeenCalled();
    expect(countUnsynced).not.toHaveBeenCalled();
  });

  it("changes the email with the current password and shows the new address", async () => {
    const saveProfile = vi.fn().mockResolvedValue({
      user: { ...baseUser, email: "alice@new.example" },
      groups: [],
      logoutUrl: "/logout",
      mcpEnabled: true,
    } satisfies SettingsUIData);
    const { result } = renderHook(() =>
      useSettingsProfileForm({ user: baseUser, operations: { saveProfile } }),
    );

    act(() => result.current.openEmailDialog());
    expect(result.current.emailDialogOpen).toBe(true);
    act(() => {
      result.current.emailForm.setValue("email", "alice@new.example");
      result.current.emailForm.setValue("currentPassword", "secret");
    });

    await act(async () => {
      await result.current.changeEmail();
    });

    expect(saveProfile).toHaveBeenCalledWith({
      email: "alice@new.example",
      currentPassword: "secret",
    });
    expect(result.current.email).toBe("alice@new.example");
    expect(result.current.emailDialogOpen).toBe(false);
    expect(toast.showSuccess).toHaveBeenCalledOnce();
  });

  it("marks a wrong current password on the field", async () => {
    const saveProfile = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error("Forbidden"), { status: 403 }));
    const { result } = renderHook(() =>
      useSettingsProfileForm({ user: baseUser, operations: { saveProfile } }),
    );

    act(() => result.current.openEmailDialog());
    act(() => {
      result.current.emailForm.setValue("email", "alice@new.example");
      result.current.emailForm.setValue("currentPassword", "wrong");
    });

    await act(async () => {
      await result.current.changeEmail();
    });

    expect(result.current.emailForm.getFieldState("currentPassword").error?.message).toBe(
      "Current password is incorrect",
    );
    expect(result.current.emailDialogOpen).toBe(true);
    expect(result.current.email).toBe(baseUser.email);
    expect(toast.showError).not.toHaveBeenCalled();
  });

  it("changes the password and signs this device out", async () => {
    const saveProfile = createSaveProfileMock();

    const { result } = renderHook(() =>
      useSettingsProfileForm({
        user: baseUser,
        operations: { saveProfile },
      }),
    );

    act(() => {
      result.current.passwordForm.setValue("newPassword", "hunter2hunter");
      result.current.passwordForm.setValue("currentPassword", "secret");
    });

    const assign = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { assign },
    });

    await act(async () => {
      await result.current.changePassword();
    });

    await waitFor(() => {
      expect(saveProfile).toHaveBeenCalledWith({
        password: "hunter2hunter",
        currentPassword: "secret",
      });
    });
    expect(completeLogout).toHaveBeenCalledOnce();
    expect(assign).toHaveBeenCalledWith("/login");
    expect(result.current.unsyncedDiscard).toBeNull();
  });

  it("asks before changing a password that would discard unsynced changes", async () => {
    countUnsynced.mockResolvedValue(2);
    const saveProfile = createSaveProfileMock();
    const { result } = renderHook(() =>
      useSettingsProfileForm({
        user: baseUser,
        operations: { saveProfile },
      }),
    );

    act(() => {
      result.current.passwordForm.setValue("newPassword", "hunter2hunter");
      result.current.passwordForm.setValue("currentPassword", "secret");
    });

    let finished = false;
    const pending = result.current.changePassword().then(() => {
      finished = true;
    });

    await waitFor(() => {
      expect(result.current.unsyncedDiscard?.description).toBe(
        "This device has 2 unsynced changes. They will be discarded.",
      );
    });
    expect(saveProfile).not.toHaveBeenCalled();
    expect(finished).toBe(false);

    await act(async () => {
      result.current.unsyncedDiscard?.confirm();
      await pending;
    });

    expect(saveProfile).toHaveBeenCalledOnce();
    expect(completeLogout).toHaveBeenCalledOnce();
  });

  it("leaves the password unchanged when the discard warning is cancelled", async () => {
    countUnsynced.mockResolvedValue(1);
    const saveProfile = createSaveProfileMock();
    const { result } = renderHook(() =>
      useSettingsProfileForm({
        user: baseUser,
        operations: { saveProfile },
      }),
    );

    act(() => {
      result.current.passwordForm.setValue("newPassword", "hunter2hunter");
      result.current.passwordForm.setValue("currentPassword", "secret");
    });

    const pending = result.current.changePassword();
    await waitFor(() => {
      expect(result.current.unsyncedDiscard?.description).toBe(
        "This device has 1 unsynced change. It will be discarded.",
      );
    });

    await act(async () => {
      result.current.unsyncedDiscard?.cancel();
      await pending;
    });

    expect(saveProfile).not.toHaveBeenCalled();
    expect(completeLogout).not.toHaveBeenCalled();
    expect(result.current.unsyncedDiscard).toBeNull();
  });

  it("asks before saving when the unsynced count cannot be read", async () => {
    countUnsynced.mockRejectedValue(new Error("indexedDB unavailable"));
    const saveProfile = createSaveProfileMock();
    const { result } = renderHook(() =>
      useSettingsProfileForm({
        user: baseUser,
        operations: { saveProfile },
      }),
    );

    act(() => {
      result.current.passwordForm.setValue("newPassword", "hunter2hunter");
      result.current.passwordForm.setValue("currentPassword", "secret");
    });

    const pending = result.current.changePassword();
    await waitFor(() => {
      expect(result.current.unsyncedDiscard?.description).toBe(
        "Unsynced changes on this device will be discarded.",
      );
    });
    expect(saveProfile).not.toHaveBeenCalled();

    await act(async () => {
      result.current.unsyncedDiscard?.cancel();
      await pending;
    });
    expect(saveProfile).not.toHaveBeenCalled();
  });

  it("releases the password save when the form unmounts during the discard prompt", async () => {
    countUnsynced.mockResolvedValue(2);
    const saveProfile = createSaveProfileMock();
    const { result, unmount } = renderHook(() =>
      useSettingsProfileForm({
        user: baseUser,
        operations: { saveProfile },
      }),
    );

    act(() => {
      result.current.passwordForm.setValue("newPassword", "hunter2hunter");
      result.current.passwordForm.setValue("currentPassword", "secret");
    });

    const pending = result.current.changePassword();
    await waitFor(() => {
      expect(result.current.unsyncedDiscard).not.toBeNull();
    });

    unmount();
    await expect(pending).resolves.toBeUndefined();
    expect(saveProfile).not.toHaveBeenCalled();
    expect(completeLogout).not.toHaveBeenCalled();
  });
});
