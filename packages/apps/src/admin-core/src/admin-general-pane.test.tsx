import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AdminGeneralPane } from "@/admin-core/src/admin-general-pane";
import { useAdminPaneStoryController } from "@/admin-core/stories/admin-pane-stories.harness";
import { AdminPaneScope } from "@/admin-core/stories/admin-story-scope";

afterEach(() => {
  cleanup();
});

function GeneralPaneHarness() {
  const controller = useAdminPaneStoryController();
  return (
    <AdminPaneScope controller={controller}>
      <AdminGeneralPane controller={controller} />
    </AdminPaneScope>
  );
}

describe("AdminGeneralPane", () => {
  it("updates the base URI when the user types", () => {
    render(<GeneralPaneHarness />);

    const baseUri = screen.getByLabelText("Base path");
    fireEvent.change(baseUri, { target: { value: "/typed-dav/" } });
    expect(screen.getByDisplayValue("/typed-dav/")).toBeTruthy();
  });
});
