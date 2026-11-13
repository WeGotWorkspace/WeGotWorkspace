import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { MeetGuestChannelFrame } from "@/meet-core/src/meet-guest-channel";
import "@/workspace-shell/src/workspace-color.css";
import "@/meet-core/src/meet-workspace.css";
import { withStatusBarInset } from "@/workspace-shell/stories/status-bar-inset-story-shared";

/** #1851 for Meet (moved from the Workspace Shell status bar stories, #1638). */
const meta: Meta = {
  title: "Layout/Workspace Shell/Status bar inset (Meet)",
  tags: ["vitest-ci"],
  decorators: [withStatusBarInset],
  parameters: {
    layout: "fullscreen",
  },
  globals: {
    viewport: { value: "mobile1", isRotated: false },
  },
};

export default meta;
type Story = StoryObj;

/** Meet guest lobby pads itself, so the shared main inset stays off (no double gap). */
export const MeetGuestLobbyPadsItself: Story = {
  render: () => (
    <MeetGuestChannelFrame>
      <p>Waiting for the host</p>
    </MeetGuestChannelFrame>
  ),
  play: async ({ canvasElement }) => {
    const main = canvasElement.querySelector(".workspace-app-layout__main");
    await expect(main).toBeTruthy();
    await expect(getComputedStyle(main!).paddingTop).toBe("0px");
  },
};
