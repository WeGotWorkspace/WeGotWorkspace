import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AdminEmailDeliveryPane } from "@/admin-core/src/admin-email-delivery-pane";
import { useAdminPaneStoryController } from "@/admin-core/stories/admin-pane-stories.harness";
import { AdminPaneScope } from "@/admin-core/stories/admin-story-scope";

afterEach(() => {
  cleanup();
});

function EmailDeliveryHarness({
  override,
}: {
  override?: Parameters<typeof useAdminPaneStoryController>[0];
} = {}) {
  const controller = useAdminPaneStoryController(override);
  return (
    <AdminPaneScope controller={controller}>
      <AdminEmailDeliveryPane controller={controller} />
    </AdminPaneScope>
  );
}

describe("AdminEmailDeliveryPane", () => {
  it("updates the From address when the user types", () => {
    render(<EmailDeliveryHarness />);

    const fromInput = screen.getByLabelText("From address");
    fireEvent.change(fromInput, { target: { value: "noreply@example.test" } });

    expect(screen.getByDisplayValue("noreply@example.test")).toBeTruthy();
    expect(
      screen.getByText(/password resets and invitations come from this address/i),
    ).toBeTruthy();
  });

  it("explains that a placeholder From is used when none is saved", () => {
    render(
      <EmailDeliveryHarness
        override={{
          mailDelivery: {
            config: { from: "" },
            capability: {
              canSubmit: true,
              selectedTransport: "php",
              probes: { fromConfigured: false },
            },
            lastTestSend: null,
          },
        }}
      />,
    );

    expect(
      screen.getByText(/mail comes from noreply@localhost and may land in spam/i),
    ).toBeTruthy();
    expect(screen.queryByText("Cannot send")).toBeNull();
  });

  it("explains that login hides Forgot password until mail can submit", () => {
    render(
      <EmailDeliveryHarness
        override={{
          mailDelivery: {
            config: { from: "" },
            capability: { canSubmit: false, selectedTransport: null },
            lastTestSend: null,
          },
        }}
      />,
    );

    expect(screen.getByText("Cannot send")).toBeTruthy();
    expect(screen.getByText(/sign-in page hides .*forgot password/i)).toBeTruthy();
  });

  it("collects a recipient before sending a test email", async () => {
    render(<EmailDeliveryHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Send test email" }));

    const sendButton = screen.getByRole("button", { name: /^Send$/ });
    expect(sendButton).toHaveProperty("disabled", true);

    fireEvent.change(screen.getByLabelText("Recipient"), {
      target: { value: "alice@example.test" },
    });
    expect(sendButton).toHaveProperty("disabled", false);

    fireEvent.click(sendButton);
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(screen.getByText(/accepted by the smtp transport/i)).toBeTruthy();
  });

  it("shows the external invitation switch and hourly limit", () => {
    render(<EmailDeliveryHarness />);

    expect(screen.getByLabelText("Invite people outside this server")).toBeTruthy();
    expect(screen.getByLabelText("Per hour")).toBeTruthy();
    expect(screen.getByLabelText("Per day")).toBeTruthy();
  });

  it("keeps the hourly limit empty while the field is cleared", () => {
    render(<EmailDeliveryHarness />);

    const limit = screen.getByLabelText("Per hour");
    fireEvent.change(limit, { target: { value: "" } });
    expect(limit).toHaveProperty("value", "");

    fireEvent.change(limit, { target: { value: "42" } });
    expect(limit).toHaveProperty("value", "42");

    const daily = screen.getByLabelText("Per day");
    fireEvent.change(daily, { target: { value: "" } });
    expect(daily).toHaveProperty("value", "");
  });
});
