import type { CSSProperties } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  UserAvatar,
  UserPresenceDot,
  USER_AVATAR_COLORS,
  avatarColorForUserId,
} from "../src/user-avatar";
import "@/mail-core/src/mail-workspace.css";
import "@/meet-core/src/meet-workspace.css";
import "@/workspace-shell/src/workspace-app-layout.css";

const meta: Meta<typeof UserAvatar> = {
  title: "Shared/User Avatar",
  component: UserAvatar,
};

export default meta;
type Story = StoryObj<typeof UserAvatar>;

export const Default: Story = {
  args: {
    displayName: "Elias Linden",
  },
};

export const Compact: Story = {
  args: {
    displayName: "Elias Linden",
    compact: true,
  },
};

export const WithImage: Story = {
  args: {
    displayName: "Jane Doe",
    imageSrc: "https://www.example.com/pub/photos/jqpublic.gif",
    compact: true,
    size: "lg",
  },
};

export const CustomColors: Story = {
  render: () => (
    <div
      style={
        {
          ["--user-avatar-bg" as string]: "rgba(255, 255, 255, 0.2)",
          ["--user-avatar-fg" as string]: "#ffffff",
          ["--user-avatar-label-color" as string]: "#ffffff",
          padding: "1.5rem",
          background: "#1a3d2e",
        } as CSSProperties
      }
    >
      <UserAvatar displayName="Ada Pereira" subtitle="ada@example.com" />
    </div>
  ),
};

export const Clickable: Story = {
  args: {
    displayName: "Ada Pereira",
    onClick: () => {},
  },
};

export const WithSubtitle: Story = {
  args: {
    displayName: "Morgan Lee",
    subtitle: "morgan@example.com",
  },
};

/** Mail detail sender row: larger chip, emerald fill, two-line label. */
export const MailSenderRow: Story = {
  render: () => (
    <div className="mail-workspace">
      <div className="mail-detail-view__sender-row max-w-[680px]">
        <UserAvatar displayName="Ops Bot" subtitle="ops@example.com · to you" size="md" />
      </div>
    </div>
  ),
};

/** Meet lobby / peer tile: compact chip on dark workspace tokens. */
export const MeetLobbyPreview: Story = {
  render: () => (
    <div
      className="meet-workspace flex min-h-48 items-center justify-center p-8"
      style={{ background: "var(--meet-surface)" }}
    >
      <UserAvatar displayName="Demo User" compact size="xl" />
    </div>
  ),
};

/** Bright hashed tiles — one stable hue per user id. */
export const HashedColors: Story = {
  render: () => {
    const authors = [
      { id: "ada.lovelace", displayName: "Ada Lovelace" },
      { id: "grace.hopper", displayName: "Grace Hopper" },
      { id: "demo.user", displayName: "Demo User" },
      { id: "alan.turing", displayName: "Alan Turing" },
      { id: "katherine.johnson", displayName: "Katherine Johnson" },
      { id: "margaret.hamilton", displayName: "Margaret Hamilton" },
    ];
    return (
      <div className="flex flex-wrap items-center gap-4 p-4">
        {authors.map((author) => (
          <UserAvatar
            key={author.id}
            displayName={author.displayName}
            compact
            size="sm"
            color={avatarColorForUserId(author.id)}
            presence="online"
          />
        ))}
        {USER_AVATAR_COLORS.map((color) => (
          <UserAvatar key={color} displayName={color} compact size="sm" color={color} />
        ))}
      </div>
    );
  },
};

/** Presence pip: solid green online, amber away, transparent + ink ring offline. */
export const Presence: Story = {
  render: () => (
    <div className="flex items-center gap-4 p-4">
      <UserAvatar displayName="Ada Lovelace" compact size="sm" presence="online" />
      <UserAvatar displayName="Katherine Johnson" compact size="sm" presence="away" />
      <UserAvatar displayName="Grace Hopper" compact size="sm" presence="offline" />
    </div>
  ),
};

/** Sidebar DM mark: presence only, no avatar. */
export const PresenceStandalone: Story = {
  render: () => (
    <div className="flex items-center gap-6 p-4">
      <span className="inline-flex items-center gap-2">
        <UserPresenceDot presence="online" standalone />
        Online
      </span>
      <span className="inline-flex items-center gap-2">
        <UserPresenceDot presence="away" standalone />
        Away
      </span>
      <span className="inline-flex items-center gap-2">
        <UserPresenceDot presence="offline" standalone />
        Offline
      </span>
    </div>
  ),
};

/** Meet knock row / compact peer tile sizes. */
export const MeetCompactSizes: Story = {
  render: () => (
    <div
      className="meet-workspace flex items-center gap-4 p-8"
      style={{ background: "var(--meet-surface)" }}
    >
      <UserAvatar displayName="Alex Morgan" compact size="sm" />
      <UserAvatar displayName="Jamie Lee" compact size="md" />
      <UserAvatar displayName="Demo User" compact size="lg" />
    </div>
  ),
};

/** Sidebar-style: chip uses footer avatar tokens, name uses shell label tone. */
export const FooterTwoLine: Story = {
  render: () => (
    <div className="workspace-app-layout__user-footer max-w-sm border border-[color-mix(in_oklab,var(--color-ink)_12%,transparent)] rounded-lg">
      <UserAvatar
        displayName="Elias Linden"
        subtitle="elias@example.com"
        className="flex-1 min-w-0"
      />
    </div>
  ),
};
