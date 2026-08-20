import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AdminEmailDeliveryPane } from "@/admin-core/src/admin-email-delivery-pane";
import { useAdminPaneStoryController } from "@/admin-core/stories/admin-pane-stories.harness";
import { AdminStoryScope } from "@/admin-core/stories/admin-story-scope";

afterEach(() => {
  cleanup();
});

function EmailDeliveryHarness() {
  const controller = useAdminPaneStoryController();
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
