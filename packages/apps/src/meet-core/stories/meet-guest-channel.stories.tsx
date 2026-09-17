import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { MeetGuestChannel } from "@/meet-core/src/meet-guest-channel";
import { meetLabels } from "@/meet-core/src/meet-labels";
import {
  MeetGuestChannelStoryHarness,
  type MeetGuestChannelStoryArgs,
} from "@/meet-core/stories/meet-call-stage.stories.harness";
import { meetStoryParameters } from "@/meet-core/stories/meet-story-shared";

/**
 * Guest stripped channel: no sidebar, cream/dusk lobby, then chat + call stage.
 * Ready to knock and Waiting after knock share the two-column invite card.
 * Checking / waiting-for-host / missing / error use the same card without media.
 */
const meta = {
  title: "Apps/Meet/Panes/MeetGuestChannel",
  component: MeetGuestChannel,
  render: (args) => <MeetGuestChannelStoryHarness {...args} />,
  parameters: {
    layout: "fullscreen",
    ...meetStoryParameters({
      componentDescription:
        "Guest landing (MeetGuestChannelFrame, no ViewHeader): invite/lobby is preview + invite card only. Checking / waiting-for-host / missing / error use the invite-column status card (Meet mark + serif title, no camera). Ready and Waiting after knock share the two-column lobby card (knock disables with a hand icon + cancel); in-channel is chat + MeetCallStage with no call-collapse control.",
      snippet: `<MeetGuestChannel
  channelName="Design"
  channelTopic="Pixels, prototypes and critiques"
  channelKind="channel"
  phase="lobby"
  lobby={lobby}
  stage={stage}
  callLayout="side-by-side"
  chat={chatPlaceholder}
/>`,
    }),
  },
  argTypes: {
    phase: {
      control: "select",
      options: [
        "checking",
        "waiting",
        "missing",
        "error",
        "ended",
        "lobby",
        "knocking",
        "in-channel",
      ] as const,
    },
    callLayout: {
      control: "select",
      options: ["side-by-side", "fullscreen"] as const,
    },
  },
} satisfies Meta<MeetGuestChannelStoryArgs>;

export default meta;
type Story = StoryObj<MeetGuestChannelStoryArgs>;

export const Checking: Story = {
  name: "Checking",
  args: {
    phase: "checking",
    callLayout: "side-by-side",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("heading", { name: meetLabels.checkingInviteTitle }),
    ).toBeInTheDocument();
    await expect(canvas.getByText(meetLabels.checkingInviteBody)).toBeInTheDocument();
    expect(canvasElement.querySelector(".meet-guest-lobby__card--status")).toBeTruthy();
    expect(canvasElement.querySelector(".meet-guest-lobby__mark")).toBeTruthy();
    expect(canvasElement.querySelector(".meet-guest-lobby__media")).toBeNull();
    await expect(canvas.queryByText(meetLabels.cameraOff)).not.toBeInTheDocument();
    await expect(
      canvas.queryByRole("button", { name: meetLabels.knockToJoin }),
    ).not.toBeInTheDocument();
    await expect(canvas.queryByRole("button", { name: "Show sidebar" })).not.toBeInTheDocument();
  },
};

export const Waiting: Story = {
  name: "Waiting",
  tags: ["vitest-ci"],
  args: {
    phase: "waiting",
    callLayout: "side-by-side",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { name: "Waiting for the host" })).toBeInTheDocument();
    await expect(
      canvas.getByText("This meeting has not started yet. You can join when the host arrives."),
    ).toBeInTheDocument();
    expect(canvasElement.querySelector(".meet-guest-lobby__card--status")).toBeTruthy();
    expect(canvasElement.querySelector(".meet-guest-lobby__mark")).toBeTruthy();
    expect(canvasElement.querySelector(".meet-guest-lobby__media")).toBeNull();
    await expect(canvas.queryByText(meetLabels.cameraOff)).not.toBeInTheDocument();
    await expect(
      canvas.queryByRole("button", { name: meetLabels.knockToJoin }),
    ).not.toBeInTheDocument();
    await expect(canvas.queryByRole("button", { name: "Show sidebar" })).not.toBeInTheDocument();
    expect(canvasElement.querySelector(".meet-workspace--split")).toBeTruthy();
    expect(canvasElement.querySelector(".meet-guest-channel__lobby")).toBeTruthy();
    expect(canvasElement.querySelector(".meet-workspace__lobby")).toBeNull();
    expect(canvasElement.querySelector(".workspace-app-layout__main-header")).toBeNull();
    await expect(canvas.queryByRole("heading", { name: "Design" })).not.toBeInTheDocument();
  },
};

export const MissingInvite: Story = {
  name: "Missing invite",
  args: {
    phase: "missing",
    callLayout: "side-by-side",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("heading", { name: meetLabels.missingInviteTitle }),
    ).toBeInTheDocument();
    await expect(canvas.getByText(meetLabels.missingInviteBody)).toBeInTheDocument();
    expect(canvasElement.querySelector(".meet-guest-lobby__card--status")).toBeTruthy();
    expect(canvasElement.querySelector(".meet-guest-lobby__mark")).toBeTruthy();
    expect(canvasElement.querySelector(".meet-guest-lobby__media")).toBeNull();
    expect(canvasElement.querySelector(".meet-workspace--split")).toBeTruthy();
  },
};

export const InviteError: Story = {
  name: "Invite check error",
  args: {
    phase: "error",
    callLayout: "side-by-side",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("heading", { name: meetLabels.inviteErrorTitle }),
    ).toBeInTheDocument();
    await expect(canvas.getByText(meetLabels.inviteErrorBody)).toBeInTheDocument();
    expect(canvasElement.querySelector(".meet-guest-lobby__card--status")).toBeTruthy();
    expect(canvasElement.querySelector(".meet-guest-lobby__mark")).toBeTruthy();
    expect(canvasElement.querySelector(".meet-guest-lobby__media")).toBeNull();
    await expect(canvas.queryByText(meetLabels.cameraOff)).not.toBeInTheDocument();
  },
};

export const Knocking: Story = {
  name: "Waiting after knock",
  tags: ["vitest-ci"],
  args: {
    phase: "knocking",
    callLayout: "side-by-side",
    displayName: "Wouter",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("heading", { name: meetLabels.invitedTitle }),
    ).toBeInTheDocument();
    await expect(canvas.getByDisplayValue("Wouter")).toBeInTheDocument();
    const knock = canvas.getByRole("button", { name: meetLabels.knockToJoin });
    await expect(knock).toBeDisabled();
    expect(knock.className).toContain("meet-guest-lobby__knock--waiting");
    await expect(canvas.getByRole("button", { name: meetLabels.cancelKnock })).toBeInTheDocument();
    await expect(canvas.getByText(meetLabels.knockNoAccount)).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(canvasElement.querySelector(".meet-guest-lobby__after-knock")).toBeTruthy();
    expect(canvasElement.querySelector(".meet-guest-lobby__card--status")).toBeNull();
    await expect(canvas.queryByText(meetLabels.knockWaitHint)).not.toBeInTheDocument();
    await expect(canvas.queryByText(meetLabels.knockingHint)).not.toBeInTheDocument();
    await expect(canvas.queryByText(meetLabels.knockWaitTitle("Design"))).not.toBeInTheDocument();
    await expect(canvas.getByText(meetLabels.cameraOff)).toBeInTheDocument();
    await expect(canvas.queryByText("design")).not.toBeInTheDocument();
    await expect(canvas.queryByText(/Pixels, prototypes and critiques/)).not.toBeInTheDocument();
    await expect(canvas.queryByRole("heading", { name: "Design" })).not.toBeInTheDocument();
    expect(canvasElement.querySelector(".workspace-app-layout__main-header")).toBeNull();
    expect(canvasElement.querySelector(".user-avatar__presence")).toBeNull();
    const disableAudio = canvas.getByRole("button", { name: meetLabels.disableAudio });
    await expect(disableAudio).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(disableAudio);
    const enableAudio = canvas.getByRole("button", { name: meetLabels.enableAudio });
    await expect(enableAudio).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(enableAudio);
    await expect(canvas.getByRole("button", { name: meetLabels.disableAudio })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await userEvent.click(canvas.getByRole("button", { name: meetLabels.cancelKnock }));
    await expect(canvas.getByRole("button", { name: meetLabels.knockToJoin })).toBeEnabled();
    await expect(canvas.getByText(meetLabels.knockNoAccount)).toBeInTheDocument();
    await expect(canvas.getByText(meetLabels.knockNoAccount)).not.toHaveAttribute("aria-hidden");
  },
};

export const Lobby: Story = {
  name: "Ready to knock",
  tags: ["vitest-ci"],
  args: {
    phase: "lobby",
    callLayout: "side-by-side",
    displayName: "Wouter",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("heading", { name: meetLabels.invitedTitle }),
    ).toBeInTheDocument();
    await expect(canvas.getByText(meetLabels.knockNoAccount)).toBeInTheDocument();
    await expect(canvas.getByText(meetLabels.knockNoAccount)).not.toHaveAttribute("aria-hidden");
    expect(canvasElement.querySelector(".meet-guest-lobby__after-knock")).toBeTruthy();
    expect(canvasElement.querySelector(".meet-guest-lobby__card--status")).toBeNull();
    expect(canvasElement.querySelector(".meet-guest-lobby__media")).toBeTruthy();
    await expect(canvas.queryByText("design")).not.toBeInTheDocument();
    await expect(canvas.queryByText(/Pixels, prototypes and critiques/)).not.toBeInTheDocument();
    await expect(canvas.queryByRole("heading", { name: "Design" })).not.toBeInTheDocument();
    expect(canvasElement.querySelector(".workspace-app-layout__main-header")).toBeNull();
    expect(canvasElement.querySelector(".user-avatar__presence")).toBeNull();
    const name = canvas.getByDisplayValue("Wouter");
    await expect(name).toBeInTheDocument();
    await expect(name).toBeEnabled();
    await userEvent.clear(name);
    await userEvent.type(name, "Ada");
    await expect(canvas.getByDisplayValue("Ada")).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: meetLabels.knockToJoin })).toBeEnabled();
    await userEvent.click(canvas.getByRole("button", { name: meetLabels.knockToJoin }));
    await expect(canvas.getByRole("button", { name: meetLabels.knockToJoin })).toBeDisabled();
    await expect(canvas.getByRole("button", { name: meetLabels.cancelKnock })).toBeInTheDocument();
    await expect(canvas.getByText(meetLabels.knockNoAccount)).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    await expect(canvas.queryByText(meetLabels.knockWaitHint)).not.toBeInTheDocument();
    await expect(canvas.queryByText(meetLabels.knockingHint)).not.toBeInTheDocument();
    await expect(canvas.queryByText(meetLabels.knockWaitTitle("Design"))).not.toBeInTheDocument();
  },
};

const IPHONE_SAFARI_VIEWPORT = { width: "390px", height: "667px" } as const;

async function assertKnockFitsIphoneShell(canvasElement: HTMLElement) {
  const shell = canvasElement.querySelector(".meet-guest-channel");
  expect(shell).toBeTruthy();
  const frame = shell as HTMLElement;
  const parent = frame.parentElement;
  if (parent) {
    parent.style.width = IPHONE_SAFARI_VIEWPORT.width;
    parent.style.height = IPHONE_SAFARI_VIEWPORT.height;
    parent.style.maxHeight = IPHONE_SAFARI_VIEWPORT.height;
    parent.style.overflow = "hidden";
  }
  frame.style.width = IPHONE_SAFARI_VIEWPORT.width;
  frame.style.height = IPHONE_SAFARI_VIEWPORT.height;
  frame.style.maxHeight = IPHONE_SAFARI_VIEWPORT.height;
  frame.style.flex = "none";
  frame.style.alignSelf = "start";
  const canvas = within(canvasElement);
  const knock = canvas.getByRole("button", { name: meetLabels.knockToJoin });
  const media = canvasElement.querySelector(".meet-guest-lobby__media");
  expect(media).toBeTruthy();
  let overflowY = "";
  for (let i = 0; i < 20; i += 1) {
    overflowY = getComputedStyle(media as HTMLElement).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") break;
    await new Promise((resolve) => {
      window.setTimeout(resolve, 50);
    });
  }
  expect(["auto", "scroll"]).toContain(overflowY);
  const knockBox = knock.getBoundingClientRect();
  const shellBox = frame.getBoundingClientRect();
  expect(shellBox.width).toBeLessThanOrEqual(391);
  expect(shellBox.height).toBeLessThanOrEqual(668);
  expect(knockBox.height).toBeGreaterThan(20);
  expect(knockBox.top).toBeGreaterThanOrEqual(shellBox.top - 1);
  expect(knockBox.bottom).toBeLessThanOrEqual(shellBox.bottom + 1);
  expect(knockBox.left).toBeGreaterThanOrEqual(shellBox.left - 1);
  expect(knockBox.right).toBeLessThanOrEqual(shellBox.right + 1);
}

export const LobbyIphone: Story = {
  name: "Ready to knock (iPhone)",
  tags: ["vitest-ci"],
  args: {
    phase: "lobby",
    callLayout: "side-by-side",
    displayName: "Wouter",
  },
  parameters: {
    viewport: {
      options: {
        iphoneSafari: {
          name: "iPhone Safari 390×667",
          styles: IPHONE_SAFARI_VIEWPORT,
          type: "mobile",
        },
      },
    },
  },
  globals: {
    viewport: { value: "iphoneSafari", isRotated: false },
  },
  play: async ({ canvasElement }) => {
    await assertKnockFitsIphoneShell(canvasElement);
  },
};

export const SignedInUnauthorized: Story = {
  name: "Signed-in unauthorized",
  tags: ["vitest-ci"],
  args: {
    phase: "lobby",
    callLayout: "side-by-side",
    displayName: "Ada Lovelace",
    hasSignedInIdentity: true,
    displayNameLocked: true,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("heading", { name: meetLabels.invitedTitle }),
    ).toBeInTheDocument();
    await expect(canvas.getByDisplayValue("Ada Lovelace")).toBeDisabled();
    await expect(canvas.getByRole("button", { name: meetLabels.knockToJoin })).toBeEnabled();
  },
};

export const InChannel: Story = {
  name: "In channel",
  tags: ["vitest-ci"],
  args: {
    phase: "in-channel",
    callLayout: "side-by-side",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvasElement.querySelector(".meet-guest-channel")).toBeTruthy();
    expect(canvasElement.querySelector(".meet-workspace--call-active")).toBeTruthy();
    expect(canvasElement.querySelector(".meet-call-expanded")).toBeTruthy();
    expect(canvasElement.querySelector(".workspace-app-layout__main-header")).toBeNull();
    expect(canvasElement.querySelector(".meet-chat")).toBeNull();
    await expect(
      canvas.queryByRole("button", { name: meetLabels.collapseCall }),
    ).not.toBeInTheDocument();
    await expect(canvas.queryByText(meetLabels.chatEmpty)).not.toBeInTheDocument();
    await expect(
      canvas.getByRole("heading", { name: meetLabels.meetInChannel("Design") }),
    ).toBeInTheDocument();
  },
};
