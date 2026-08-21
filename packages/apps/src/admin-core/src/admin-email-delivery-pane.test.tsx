import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AdminEmailDeliveryPane } from "@/admin-core/src/admin-email-delivery-pane";
import { useAdminPaneStoryController } from "@/admin-core/stories/admin-pane-stories.harness";
import { AdminStoryScope } from "@/admin-core/stories/admin-story-scope";

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
    <AdminStoryScope>
      <AdminEmailDeliveryPane controller={controller} />
    </AdminStoryScope>
  );
}

describe("AdminEmailDeliveryPane", () => {
  it("updates the From address when the user types", () => {
    render(<EmailDeliveryHarness />);

    const fromInput = screen.getByLabelText("From address");
    fireEvent.change(fromInput, { target: { value: "noreply@example.test" } });

    expect(screen.getByDisplayValue("noreply@example.test")).toBeTruthy();
    expect(
      screen.getByText(/password recovery uses this from address and transport/i),
    ).toBeTruthy();
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

    expect(screen.getByText(/cannot submit yet/i)).toBeTruthy();
    expect(screen.getByText(/login hides .*forgot password/i)).toBeTruthy();
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
});
