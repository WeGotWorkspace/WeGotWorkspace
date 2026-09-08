import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AdminMcpPane } from "@/admin-core/src/admin-mcp-pane";
import { useAdminPaneStoryController } from "@/admin-core/stories/admin-pane-stories.harness";
import { AdminStoryScope } from "@/admin-core/stories/admin-story-scope";

function Harness() {
  const controller = useAdminPaneStoryController();
  return (
    <AdminStoryScope>
      <AdminMcpPane controller={controller} />
    </AdminStoryScope>
  );
}

describe("AdminMcpPane", () => {
  it("renders the kill-switch row off by default", () => {
    render(<Harness />);
    expect(screen.getByText("Allow connected assistants")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeTruthy();
  });
});
