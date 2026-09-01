import type { Meta, StoryObj } from "@storybook/react-vite";
import { createMeetAppBootstrap } from "@/lib/api/mock/meet-bootstrap";
import { MeetCallWorkspace } from "@/meet-core/src/meet-call-workspace";

const meta: Meta<typeof MeetCallWorkspace> = {
  title: "Apps/Meet/CallWorkspace",
  component: MeetCallWorkspace,
  parameters: {
    layout: "fullscreen",
  },
};

export default meta;
type Story = StoryObj<typeof MeetCallWorkspace>;

export const Default: Story = {
  args: {
    ...createMeetAppBootstrap(),
    onLogout: () => {},
  },
};
