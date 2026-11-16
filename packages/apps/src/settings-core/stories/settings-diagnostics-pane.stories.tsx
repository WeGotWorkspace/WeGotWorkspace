import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, screen, waitFor } from "storybook/test";
import { withDarkTheme } from "@/branding-playground/dark-theme-story";
import type { ErrorDiagnosticEntry } from "@/lib/diagnostics/error-diagnostics-store";
import { SettingsDiagnosticsPane } from "@/settings-core/src/settings-diagnostics-pane";
import { SettingsStoryScope } from "./settings-story-scope";

const RECORDED: ErrorDiagnosticEntry[] = [
  {
    id: 3,
    time: "2026-11-16T10:42:00.000Z",
    source: "route",
    name: "TypeError",
    message: "Cannot read properties of undefined (reading 'title')",
    stack: [
      "TypeError: Cannot read properties of undefined (reading 'title')",
      "    at NoteRow (/assets/notes-core-B3kq9.js:41:17)",
      "    at renderWithHooks (/assets/index-Cx81d.js:3:20112)",
    ].join("\n"),
    app: "notes",
    route: "/notes/all",
    build: "0.1.124-beta.3 (ca4543349)",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15",
    count: 3,
  },
  {
    id: 2,
    time: "2026-11-16T09:15:00.000Z",
    source: "unhandledrejection",
    name: "RangeError",
    message: "Invalid time value",
    stack: "RangeError: Invalid time value\n    at formatDay (/assets/calendar-core-Q1az.js:88:9)",
    app: "calendar",
    route: "/calendar/week/2026-11-16",
    build: "0.1.124-beta.3 (ca4543349)",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15",
    count: 1,
  },
];

const meta = {
  title: "Features/Settings/Diagnostics pane",
  component: SettingsDiagnosticsPane,
  parameters: { layout: "padded" },
  args: {
    load: async () => RECORDED,
    copyText: fn(async () => true),
    now: () => new Date("2026-11-16T10:45:00.000Z"),
  },
  decorators: [
    (Story) => (
      <SettingsStoryScope>
        <Story />
      </SettingsStoryScope>
    ),
  ],
} satisfies Meta<typeof SettingsDiagnosticsPane>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Two errors kept on the device; the text below is exactly what Copy puts on the clipboard. */
export const WithErrors: Story = {
  play: async ({ args }) => {
    await screen.findByText(/^2 errors kept on this device/);
    screen.getByRole("button", { name: "Copy diagnostics" }).click();
    await waitFor(() => expect(args.copyText).toHaveBeenCalledOnce());
  },
};

export const Empty: Story = {
  args: { load: async () => [] },
  play: async () => {
    await screen.findByText("No errors recorded on this device.");
    await expect(screen.getByRole("button", { name: "Copy diagnostics" })).toBeDisabled();
  },
};

/** Plain http blocks the clipboard: the text is selected so the person can copy it by hand. */
export const CopyBlocked: Story = {
  args: { copyText: fn(async () => false) },
  play: async () => {
    await screen.findByText(/^2 errors kept on this device/);
    screen.getByRole("button", { name: "Copy diagnostics" }).click();
    await screen.findByRole("alert");
  },
};

export const WithErrorsDark: Story = {
  decorators: [withDarkTheme],
};

export const EmptyDark: Story = {
  args: { load: async () => [] },
  decorators: [withDarkTheme],
};
