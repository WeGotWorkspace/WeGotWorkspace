import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AdminRealtimeCollaborationPane } from "@/admin-core/src/admin-realtime-collaboration-pane";
import { useAdminPaneStoryController } from "@/admin-core/stories/admin-pane-stories.harness";
import { AdminPaneScope } from "@/admin-core/stories/admin-story-scope";
import type { AdminSettingsFormState } from "@/admin-core/src/admin-settings-form-utils";
import { TooltipProvider } from "@/ui/tooltip";

afterEach(() => {
  cleanup();
});

function RealtimePaneHarness({ form }: { form?: Partial<AdminSettingsFormState> }) {
  const controller = useAdminPaneStoryController();
  const patched = form
    ? { ...controller, settingsForm: { ...controller.settingsForm, ...form } }
    : controller;
  return (
    <TooltipProvider delayDuration={0}>
      <AdminPaneScope controller={controller}>
        <AdminRealtimeCollaborationPane controller={patched} />
      </AdminPaneScope>
    </TooltipProvider>
  );
}

describe("AdminRealtimeCollaborationPane", () => {
  it("updates STUN and TURN fields when the user types", () => {
    render(<RealtimePaneHarness />);

    const stunUrls = screen.getByLabelText("STUN URL 1");
    fireEvent.change(stunUrls, { target: { value: "stun:typed.test:3478" } });
    expect(screen.getByDisplayValue("stun:typed.test:3478")).toBeTruthy();

    const turnUrls = screen.getByLabelText("TURN URL 1");
    fireEvent.change(turnUrls, { target: { value: "turn:typed.test:3478" } });
    expect(screen.getByDisplayValue("turn:typed.test:3478")).toBeTruthy();

    const turnSecret = screen.getByLabelText("TURN shared secret");
    fireEvent.change(turnSecret, { target: { value: "typed-secret" } });
    expect(screen.getByDisplayValue("typed-secret")).toBeTruthy();
  });

  it("reports whether a secret is stored without ever showing it", () => {
    const { unmount } = render(<RealtimePaneHarness form={{ turnSecretSet: false }} />);
    expect(screen.getByText("The use-auth-secret value of your TURN server.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
    unmount();

    render(<RealtimePaneHarness form={{ turnSecretSet: true }} />);
    expect(screen.getByText(/^Saved\. It is never shown again/)).toBeTruthy();
    expect((screen.getByLabelText("TURN shared secret") as HTMLInputElement).value).toBe("");
    expect(screen.getByRole("button", { name: "Clear" })).toBeTruthy();
  });

  it("warns while static credentials from an older release are still stored", () => {
    const { unmount } = render(
      <RealtimePaneHarness form={{ turnStaticCredentialsPresent: false }} />,
    );
    expect(screen.queryByText(/TURN username and password from an older release/)).toBeNull();
    unmount();

    render(<RealtimePaneHarness form={{ turnStaticCredentialsPresent: true }} />);
    expect(screen.getByText(/TURN username and password from an older release/)).toBeTruthy();
  });

  it("shows forced relay off and disabled without TURN", () => {
    render(
      <RealtimePaneHarness
        form={{
          turnSecretSet: false,
          turnUrls: "",
          rtcDebugLogging: false,
          rtcForceRelay: true,
        }}
      />,
    );
    expect(screen.getByText("Troubleshooting")).toBeTruthy();
    expect(screen.getByLabelText("Detailed connection logs")).toBeTruthy();
    const relay = screen.getByLabelText("Always use the relay");
    expect((relay as HTMLButtonElement).disabled).toBe(true);
    expect((relay as HTMLButtonElement).getAttribute("aria-checked")).toBe("false");
    expect(screen.getByText("Needs TURN")).toBeTruthy();
  });

  it("enables the forced relay switch when TURN URL and secret are saved", () => {
    render(
      <RealtimePaneHarness
        form={{
          turnSecretSet: true,
          turnUrls: "turn:relay.example.test:3478",
          rtcForceRelay: false,
        }}
      />,
    );
    const relay = screen.getByLabelText("Always use the relay");
    expect((relay as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText("Needs TURN")).toBeNull();
  });
});
