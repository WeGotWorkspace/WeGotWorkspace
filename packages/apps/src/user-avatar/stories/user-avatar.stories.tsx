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
import "@/docs-core/src/docs-workspace.css";
import "@/text-editor-core/docs-collab/docs-collab-presence.css";

const meta: Meta<typeof UserAvatar> = {
  title: "Shared/User Avatar",
  component: UserAvatar,
  argTypes: {
    size: {
      control: "select",
      options: ["xs", "sm", "md", "lg", "xl"],
    },
    presence: {
      control: "select",
      options: [undefined, "online", "away", "offline"],
    },
    compact: { control: "boolean" },
    color: {
      control: "select",
      options: [undefined, ...USER_AVATAR_COLORS],
    },
  },
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

/** Name only vs name+subtitle vs mark-only. */
export const LabelVariants: Story = {
  render: () => (
    <div className="flex flex-col gap-4 p-4 max-w-sm">
      <UserAvatar displayName="Elias Linden" />
      <UserAvatar displayName="Elias Linden" subtitle="elias@example.com" />
      <UserAvatar displayName="Elias Linden" compact />
    </div>
  ),
};

/** Size ladder used across the suite. */
export const SizeMatrix: Story = {
  render: () => (
    <div className="flex flex-wrap items-end gap-4 p-4">
      {(["xs", "sm", "md", "lg", "xl"] as const).map((size) => (
        <div key={size} className="flex flex-col items-center gap-2">
          <UserAvatar displayName="Ada Lovelace" compact size={size} />
          <span className="text-xs opacity-60">{size}</span>
        </div>
      ))}
    </div>
  ),
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

/** Standalone presence pip (no mark) — e.g. density demos. DM rows use UserAvatar. */
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

/** Docs/notes collab peer stack (overlapping xs marks). */
export const CollabPeerStack: Story = {
  render: () => (
    <div className="docs-workspace p-4">
      <div className="docs-collab-presence" aria-label="Connected editors">
        <span className="docs-collab-presence__chip">
          <UserAvatar
            displayName="Alex Example"
            compact
            size="xs"
            className="docs-collab-presence__avatar docs-collab-presence__avatar--self"
          />
        </span>
        <span className="docs-collab-presence__chip docs-collab-presence__chip--overlap">
          <UserAvatar
            displayName="Sam Lee"
            compact
            size="xs"
            color={avatarColorForUserId("peer-1")}
            className="docs-collab-presence__avatar"
          />
        </span>
        <span className="docs-collab-presence__chip docs-collab-presence__chip--overlap">
          <UserAvatar
            displayName="Jordan Kim"
            compact
            size="xs"
            color={avatarColorForUserId("peer-2")}
            className="docs-collab-presence__avatar"
          />
        </span>
      </div>
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

/** Icon / org fallback inside the mark (Contacts org, Drive public link). */
export const WithFallbackIcon: Story = {
  render: () => (
    <div className="flex items-center gap-4 p-4">
      <UserAvatar displayName="Acme Corp" compact size="sm" fallback="Org" />
      <UserAvatar displayName="Public link" compact size="sm" fallback="Pub" />
    </div>
  ),
};
