import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { MeetPeerTile } from "@/meet-core/src/meet-peer-tile";
import {
  meetStoryParameters,
  STORY_NOOP,
  storyBooleanControl,
  storyTextControl,
} from "@/meet-core/stories/meet-story-shared";
import { MeetStoryScope } from "@/meet-core/stories/meet-story-scope";

const meta = {
  title: "Features/Meet/Components/MeetPeerTile",
  component: MeetPeerTile,
  parameters: meetStoryParameters(),
  render: (args) => (
    <MeetStoryScope variant="in-call">
      <div className="h-80 w-full max-w-3xl p-4">
        <div className="meet-call-stage h-full">
          <ul className="meet-call-stage__grid h-full" data-columns="1">
            <li className="meet-call-stage__grid-item">
              <MeetPeerTile {...args} />
            </li>
          </ul>
        </div>
      </div>
    </MeetStoryScope>
  ),
  argTypes: {
    name: storyTextControl,
    compact: storyBooleanControl,
  },
} satisfies Meta<typeof MeetPeerTile>;

export default meta;
type Story = StoryObj<typeof MeetPeerTile>;

export const NoVideo: Story = {
  name: "No video",
  args: {
    name: "Alex Morgan",
    stream: null,
    compact: false,
    spotlight: true,
    disclosedMedia: { camera: true, mic: true },
    onMuteParticipant: STORY_NOOP,
  },
};

/**
 * A peer that cannot connect: the avatar with the status under it, on dark media
 * paper with no edge. Name tag and pin/mute are the larger sizes.
 */
export const Unreachable: Story = {
  name: "Unreachable",
  tags: ["vitest-ci"],
  args: {
    name: "Alex Morgan",
    stream: null,
    caption: "Can't connect to Alex Morgan",
    disclosedMedia: { camera: false, mic: false },
    onMuteParticipant: STORY_NOOP,
  },
  play: async ({ canvasElement }) => {
    const tile = canvasElement.querySelector<HTMLElement>(".meet-peer-tile")!;
    const avatar = tile
      .querySelector(".meet-peer-tile__fill .user-avatar")!
      .getBoundingClientRect();
    const caption = tile.querySelector(".meet-peer-tile__caption")!.getBoundingClientRect();
    await expect(caption.top).toBeGreaterThanOrEqual(avatar.bottom);
    await expect(getComputedStyle(tile).borderTopWidth).toBe("0px");
    await expect(getComputedStyle(tile).backgroundColor).toBe(
      getComputedStyle(tile.querySelector(".meet-peer-tile__fill")!).backgroundColor,
    );
    await expect(tile.querySelector(".meet-peer-tile__name")?.classList).toContain("tag--size-lg");
    for (const control of tile.querySelectorAll<HTMLElement>(".meet-peer-tile__control")) {
      await expect(control.getBoundingClientRect().height).toBe(32);
    }
  },
};

export const CompactStrip: Story = {
  name: "Compact strip",
  args: {
    name: "Jamie Lee",
    stream: null,
    compact: true,
    disclosedMedia: { camera: true, mic: true },
    onMuteParticipant: STORY_NOOP,
  },
};

export const Speaking: Story = {
  name: "Speaking",
  args: {
    name: "Alex Morgan",
    stream: null,
    speaking: true,
    disclosedMedia: { camera: true, mic: true },
    onMuteParticipant: STORY_NOOP,
  },
};

export const SelfLive: Story = {
  name: "Self mic on",
  args: {
    name: "You",
    stream: null,
    self: true,
    compact: true,
    micOn: true,
    onToggleMic: STORY_NOOP,
  },
};

export const SelfMuted: Story = {
  name: "Self mic off",
  args: {
    name: "You",
    stream: null,
    self: true,
    compact: true,
    micOn: false,
    onToggleMic: STORY_NOOP,
  },
};

export const PeerMuted: Story = {
  name: "Peer muted",
  args: {
    name: "Jamie Lee",
    stream: null,
    compact: true,
    disclosedMedia: { camera: true, mic: false },
    onMuteParticipant: STORY_NOOP,
  },
};
