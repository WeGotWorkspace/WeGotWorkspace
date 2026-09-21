import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AdminRealtimeCollaborationPane } from "@/admin-core/src/admin-realtime-collaboration-pane";
import { useAdminPaneStoryController } from "@/admin-core/stories/admin-pane-stories.harness";
import { AdminStoryScope } from "@/admin-core/stories/admin-story-scope";

afterEach(() => {
  cleanup();
});

function RealtimePaneHarness() {
  const controller = useAdminPaneStoryController();
  return (
    <AdminStoryScope>
      <AdminRealtimeCollaborationPane controller={controller} />
    </AdminStoryScope>
  );
}

describe("AdminRealtimeCollaborationPane", () => {
  it("updates STUN and TURN fields when the user types", () => {
    render(<RealtimePaneHarness />);

    const stunUrls = screen.getByLabelText("STUN URLs");
    fireEvent.change(stunUrls, { target: { value: "stun:typed.test:3478" } });
    expect(screen.getByDisplayValue("stun:typed.test:3478")).toBeTruthy();

    const turnUrls = screen.getByLabelText("TURN URLs");
    fireEvent.change(turnUrls, { target: { value: "turn:typed.test:3478" } });
    expect(screen.getByDisplayValue("turn:typed.test:3478")).toBeTruthy();

    const turnUsername = screen.getByLabelText("TURN username");
    fireEvent.change(turnUsername, { target: { value: "typed-user" } });
    expect(screen.getByDisplayValue("typed-user")).toBeTruthy();

    const turnPassword = screen.getByLabelText("TURN password");
    fireEvent.change(turnPassword, { target: { value: "typed-secret" } });
    expect(screen.getByDisplayValue("typed-secret")).toBeTruthy();
  });
});
