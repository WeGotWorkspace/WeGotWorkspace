import type { Meta, StoryObj } from "@storybook/react-vite";
import { createBrandingStoryMeta } from "@/branding-playground";
import { createMailAppBootstrap } from "@/lib/api/mock/mail-bootstrap";
import { folderTokenFromMailboxLabel } from "@/lib/mail/folder-token";
import { mailStoryLabels } from "@/mail-core/src/mail-app.stories.fixtures";
import { MailWorkspace } from "@/mail-core/src/mail-workspace";

const STORY_SYSTEM_MAILBOXES = [
  "Inbox",
  "Starred",
  "Sent",
  "Drafts",
  "Spam",
  "Archive",
  "Trash",
] as const;

const bootstrap = createMailAppBootstrap();

const brandingMeta = createBrandingStoryMeta({
  appId: "mail",
  workspaceClass: "mail-workspace",
  accentToken: "mail-accent",
  component: MailWorkspace,
});

const meta = {
  ...brandingMeta,
  title: "Branding/Mail",
  tags: ["vitest-ci"],
} satisfies Meta<typeof MailWorkspace>;

export default meta;
type Story = StoryObj<typeof MailWorkspace>;

export const Default: Story = {
  args: {
    messages: bootstrap.data.mail,
    mailboxes: bootstrap.data.mailboxes,
    session: bootstrap.session,
    labels: mailStoryLabels,
    listLoading: false,
    systemMailboxes: STORY_SYSTEM_MAILBOXES,
    encodeFolderToken: folderTokenFromMailboxLabel,
    onLogout: () => {},
  },
};
