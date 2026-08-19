import { StrictMode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AdminEmailDeliveryPane } from "@/admin-core/src/admin-email-delivery-pane";
import { useAdminPaneStoryController } from "@/admin-core/stories/admin-pane-stories.harness";
import { AdminStoryScope } from "@/admin-core/stories/admin-story-scope";

function EmailDeliveryHarness() {
  const controller = useAdminPaneStoryController();
  return (
    <StrictMode>
      <AdminStoryScope>
        <AdminEmailDeliveryPane controller={controller} />
      </AdminStoryScope>
    </StrictMode>
  );
}

describe("AdminEmailDeliveryPane", () => {
  it("updates the From address when the user types", () => {
    render(<EmailDeliveryHarness />);

    const fromInput = screen.getByLabelText("From address");
    fireEvent.change(fromInput, { target: { value: "noreply@example.test" } });

    expect(screen.getByDisplayValue("noreply@example.test")).toBeTruthy();
  });
});
