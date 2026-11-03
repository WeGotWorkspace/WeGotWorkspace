import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SettingsUIData } from "@/settings-core/src/settings-types";
import { useSettingsProfileForm } from "@/settings-core/src/use-settings-profile-form";

const { completeLogout, countUnsynced } = vi.hoisted(() => ({
  completeLogout: vi.fn(async () => "member_login" as const),
  countUnsynced: vi.fn(async () => 0),
}));

vi.mock("@/hooks/use-run-with-app-toast", () => ({
  useRunWithAppToast: () => async (work: () => Promise<unknown>) => work(),
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
    countUnsynced.mockReset();
    countUnsynced.mockResolvedValue(0);
  });

  it("calls saveProfile with OpenAPI-shaped identity fields", async () => {
    const saveProfile = createSaveProfileMock();

    const { result } = renderHook(() =>
      useSettingsProfileForm({
        user: baseUser,
        operations: { saveProfile },
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
      });
    });
    expect(completeLogout).not.toHaveBeenCalled();
    expect(countUnsynced).not.toHaveBeenCalled();
  });

  it("includes password in the request when a new password is set", async () => {
    const saveProfile = createSaveProfileMock();

    const { result } = renderHook(() =>
      useSettingsProfileForm({
        user: baseUser,
        operations: { saveProfile },
      }),
    );

    act(() => {
      result.current.form.setValue("newPassword", "hunter2hunter", { shouldDirty: true });
      result.current.form.setValue("confirmPassword", "hunter2hunter", { shouldDirty: true });
      result.current.form.setValue("currentPassword", "secret", { shouldDirty: true });
    });

    const assign = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { assign },
    });

    await act(async () => {
      await result.current.saveProfile();
    });

    await waitFor(() => {
      expect(saveProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          displayName: "Alice Example",
          password: "hunter2hunter",
          currentPassword: "secret",
        }),
      );
    });
    expect(completeLogout).toHaveBeenCalledOnce();
    expect(assign).toHaveBeenCalledWith("/login");
    expect(result.current.unsyncedDiscard).toBeNull();
  });

  it("asks before saving a password change that would discard unsynced changes", async () => {
    countUnsynced.mockResolvedValue(2);
    const saveProfile = createSaveProfileMock();
    const { result } = renderHook(() =>
      useSettingsProfileForm({
        user: baseUser,
        operations: { saveProfile },
      }),
    );

    act(() => {
      result.current.form.setValue("newPassword", "hunter2hunter", { shouldDirty: true });
      result.current.form.setValue("confirmPassword", "hunter2hunter", { shouldDirty: true });
      result.current.form.setValue("currentPassword", "secret", { shouldDirty: true });
    });

    let finished = false;
    const pending = result.current.saveProfile().then(() => {
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
      result.current.form.setValue("newPassword", "hunter2hunter", { shouldDirty: true });
      result.current.form.setValue("confirmPassword", "hunter2hunter", { shouldDirty: true });
      result.current.form.setValue("currentPassword", "secret", { shouldDirty: true });
    });

    const pending = result.current.saveProfile();
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
      result.current.form.setValue("newPassword", "hunter2hunter", { shouldDirty: true });
      result.current.form.setValue("confirmPassword", "hunter2hunter", { shouldDirty: true });
      result.current.form.setValue("currentPassword", "secret", { shouldDirty: true });
    });

    const pending = result.current.saveProfile();
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
      result.current.form.setValue("newPassword", "hunter2hunter", { shouldDirty: true });
      result.current.form.setValue("confirmPassword", "hunter2hunter", { shouldDirty: true });
      result.current.form.setValue("currentPassword", "secret", { shouldDirty: true });
    });

    const pending = result.current.saveProfile();
    await waitFor(() => {
      expect(result.current.unsyncedDiscard).not.toBeNull();
    });

    unmount();
    await expect(pending).resolves.toBeUndefined();
    expect(saveProfile).not.toHaveBeenCalled();
    expect(completeLogout).not.toHaveBeenCalled();
  });
});
