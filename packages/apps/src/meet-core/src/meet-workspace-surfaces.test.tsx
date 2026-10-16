import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { meetLabels } from "@/meet-core/src/meet-labels";
import { MeetWorkspaceMainSurfaces } from "@/meet-core/src/meet-workspace-surfaces";

describe("MeetWorkspaceMainSurfaces empty channel", () => {
  it("shows a collection-state icon above the select-a-channel label", () => {
    render(
      <MeetWorkspaceMainSurfaces open={false} showExpandedStage={false} keepCallChrome={false} />,
    );
    const label = screen.getByText(meetLabels.emptyChannelMain);
    expect(label.closest(".meet-workspace__chat-empty .collection-state__body")).toBeTruthy();
    expect(document.querySelector(".meet-workspace__chat-empty .lucide-hash")).toBeTruthy();
  });
});
