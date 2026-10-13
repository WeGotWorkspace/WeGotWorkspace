import { fireEvent, render, screen } from "@testing-library/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { describe, expect, it, vi } from "vitest";
import { SettingsProfilePane } from "@/settings-core/src/settings-profile-pane";
import {
  settingsProfileFormSchema,
  type SettingsProfileFormValues,
} from "@/settings-core/src/settings-profile-form-schema";
import type { SettingsProfileUnsyncedDiscard } from "@/settings-core/src/use-settings-profile-form";

function ProfilePaneHarness({
  unsyncedDiscard = null,
}: {
  unsyncedDiscard?: SettingsProfileUnsyncedDiscard | null;
}) {
  const form = useForm<SettingsProfileFormValues>({
    resolver: zodResolver(settingsProfileFormSchema),
    defaultValues: {
      displayName: "Demo User",
      email: "demo@example.test",
      newPassword: "",
      confirmPassword: "",
      currentPassword: "",
    },
    mode: "onSubmit",
  });

  return (
    <SettingsProfilePane
      profile={{
        username: "demo.user",
        form,
        saveProfile: form.handleSubmit(async () => {}),
        unsyncedDiscard,
      }}
    />
  );
}

describe("SettingsProfilePane", () => {
  it("enables Save changes when display name is edited", () => {
    render(<ProfilePaneHarness />);

    const saveButton = screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);

    const displayName = screen.getByLabelText("Display name");
    fireEvent.change(displayName, { target: { value: "Updated name" } });

    expect(saveButton.disabled).toBe(false);
  });

  it("shows Current password when the email field is dirty", () => {
    render(<ProfilePaneHarness />);

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "other@example.test" },
    });

    const currentPassword = screen.getByLabelText("Current password");
    expect(currentPassword.getAttribute("autocomplete")).toBe("current-password");
  });

  it("shows Current password when a new password is entered", () => {
    render(<ProfilePaneHarness />);

    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "hunter2hunter" },
    });

    expect(screen.getByLabelText("Current password")).toBeTruthy();
  });

  it("hides Current password when only the display name is dirty", () => {
    render(<ProfilePaneHarness />);

    fireEvent.change(screen.getByLabelText("Display name"), {
      target: { value: "Updated name" },
    });

    expect(screen.queryByLabelText("Current password")).toBeNull();
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
});
