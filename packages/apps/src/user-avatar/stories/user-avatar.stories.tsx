import type { CSSProperties } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import {
  UserAvatar,
  UserPresenceDot,
  USER_AVATAR_COLORS,
  avatarColorForUserId,
} from "../src/user-avatar";
import "@/workspace-shell/src/workspace-app-layout.css";

const meta: Meta<typeof UserAvatar> = {
  title: "UI/Primitives/User Avatar",
  component: UserAvatar,
  argTypes: {
    size: {
      control: "select",
      options: ["xs", "sm", "md", "lg", "xl"],
    },
    presence: {
      control: "select",
      options: [undefined, "online", "away", "offline", "pending"],
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

/** Chat authors: no hairline, a soft selection-colour wash, the same for everyone. */
export const Tint: Story = {
  tags: ["vitest-ci"],
  render: () => (
    <div className="flex items-center gap-3">
      {["Ada Lovelace", "Grace Hopper", "Alan Turing"].map((name) => (
        <UserAvatar key={name} displayName={name} compact variant="tint" color="cyan" />
      ))}
    </div>
  ),
  play: async ({ canvasElement }) => {
    const marks = within(canvasElement).getAllByRole("img");
    const probe = document.createElement("span");
    probe.style.color =
      "color-mix(in oklab, var(--scheme-selection) 40%, var(--workspace-surface))";
    canvasElement.appendChild(probe);
    const fill = getComputedStyle(probe).color;
    probe.remove();
    for (const mark of marks) {
      const style = getComputedStyle(mark);
      await expect(style.borderTopWidth).toBe("0px");
      await expect(style.borderTopLeftRadius).not.toBe("9999px");
      // One colour for everyone: `color` is ignored.
      await expect(style.backgroundColor).toBe(fill);
    }
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

/** Size ladder — `xs`…`xl` match ControlSize; `2xl` is display-only. */
export const SizeMatrix: Story = {
  render: () => (
    <div className="flex flex-wrap items-end gap-4 p-4">
      {(["xs", "sm", "md", "lg", "xl", "2xl"] as const).map((size) => (
        <div key={size} className="flex flex-col items-center gap-2">
          <UserAvatar displayName="Ada Lovelace" compact size={size} />
          <span className="text-xs opacity-80">{size}</span>
        </div>
      ))}
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

/**
 * Presence pip: solid green online, amber away, transparent + ink ring offline,
 * blue pending (a save or sync still in flight, not a person's status).
 */
export const Presence: Story = {
  render: () => (
    <div className="flex items-center gap-4 p-4">
      <UserAvatar displayName="Ada Lovelace" compact size="sm" presence="online" />
      <UserAvatar displayName="Katherine Johnson" compact size="sm" presence="away" />
      <UserAvatar displayName="Grace Hopper" compact size="sm" presence="offline" />
      <UserAvatar displayName="Dorothy Vaughan" compact size="sm" presence="pending" />
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
      <span className="inline-flex items-center gap-2">
        <UserPresenceDot presence="pending" standalone />
        Pending sync
      </span>
    </div>
  ),
};

/** Sidebar-style: chip uses footer avatar tokens, name uses shell label tone. */
export const FooterTwoLine: Story = {
  render: () => (
    <div className="workspace-app-layout__user-footer max-w-sm border border-[color-mix(in_oklab,var(--color-we-got-dark)_12%,transparent)] rounded-lg">
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
