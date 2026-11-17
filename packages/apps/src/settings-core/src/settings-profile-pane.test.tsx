import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SettingsProfilePane } from "@/settings-core/src/settings-profile-pane";
import {
  useSettingsProfileForm,
  type SettingsProfileUnsyncedDiscard,
} from "@/settings-core/src/use-settings-profile-form";

vi.mock("@/hooks/use-app-toast", () => ({
  useAppToast: () => ({
    show: vi.fn(),
    dismiss: vi.fn(),
    showSuccess: vi.fn(),
    showError: vi.fn(),
  }),
}));

const user = {
  username: "demo.user",
  displayName: "Demo User",
  email: "demo@example.test",
};

function ProfilePaneHarness({
  unsyncedDiscard = null,
}: {
  unsyncedDiscard?: SettingsProfileUnsyncedDiscard | null;
}) {
  const profile = useSettingsProfileForm({
    user,
    operations: { saveProfile: vi.fn() },
    countUnsyncedChanges: async () => 0,
  });
  return <SettingsProfilePane profile={{ ...profile, unsyncedDiscard }} />;
}

function changeButtons() {
  const [email, password] = screen.getAllByRole("button", { name: "Change" });
  return { email: email!, password: password! };
}

describe("SettingsProfilePane", () => {
  it("shows the account with the display name as the one editable field", () => {
    render(<ProfilePaneHarness />);

    expect((screen.getByLabelText("Username") as HTMLInputElement).readOnly).toBe(true);
    expect((screen.getByLabelText("Display name") as HTMLInputElement).readOnly).toBe(false);
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe(user.email);
    expect(screen.getByText("Security")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
  });

  it("opens Change email with the current password field", () => {
    render(<ProfilePaneHarness />);

    fireEvent.click(changeButtons().email);

    expect(screen.getByRole("dialog").textContent).toContain("Change email");
    expect(screen.getByLabelText("Current password").getAttribute("autocomplete")).toBe(
      "current-password",
    );
  });

  it("opens Change password with the current and the new password only", () => {
    render(<ProfilePaneHarness />);

    fireEvent.click(changeButtons().password);

    expect(screen.getByLabelText("Current password")).toBeTruthy();
    expect(screen.getByLabelText("New password").getAttribute("autocomplete")).toBe("new-password");
    expect(screen.queryByLabelText(/confirm/i)).toBeNull();
  });

  it("confirms discarding unsynced changes before the password is saved", () => {
    const confirm = vi.fn();
    const cancel = vi.fn();
    const { rerender } = render(<ProfilePaneHarness />);
    expect(screen.queryByRole("alertdialog")).toBeNull();

    rerender(
      <ProfilePaneHarness
        unsyncedDiscard={{
          description: "This device has 2 unsynced changes. They will be discarded.",
          confirm,
          cancel,
        }}
      />,
    );

    expect(screen.getByRole("alertdialog").textContent).toContain(
      "This device has 2 unsynced changes. They will be discarded.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(cancel).toHaveBeenCalledOnce();
    expect(confirm).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Change password" }));
    expect(confirm).toHaveBeenCalledOnce();
  });

  it("cancels a later discard prompt after an earlier confirm", () => {
    const firstConfirm = vi.fn();
    const firstCancel = vi.fn();
    const secondCancel = vi.fn();
    const { rerender } = render(
      <ProfilePaneHarness
        unsyncedDiscard={{
          description: "This device has 2 unsynced changes. They will be discarded.",
          confirm: firstConfirm,
          cancel: firstCancel,
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Change password" }));
    expect(firstConfirm).toHaveBeenCalledOnce();
    expect(firstCancel).not.toHaveBeenCalled();

    rerender(<ProfilePaneHarness unsyncedDiscard={null} />);
    expect(screen.queryByRole("alertdialog")).toBeNull();

    rerender(
      <ProfilePaneHarness
        unsyncedDiscard={{
          description: "This device has 1 unsynced change. It will be discarded.",
          confirm: vi.fn(),
          cancel: secondCancel,
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(secondCancel).toHaveBeenCalledOnce();
    expect(firstCancel).not.toHaveBeenCalled();
  });
});
