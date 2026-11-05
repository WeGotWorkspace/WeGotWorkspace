import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { DriveGridView } from "@/drive-core/src/drive-browser";
import { DriveFileAvatar } from "@/drive-core/src/drive-file-avatar";
import { extensionHue } from "@/drive-core/src/drive-file-avatar-label";
import type { DriveFile } from "@/drive-core/src/drive-models";
import { createDriveBrowserStoryProps } from "@/drive-core/stories/drive-pane-stories.fixtures";
import { driveStoryParameters, STORY_NOOP } from "@/drive-core/stories/drive-story-shared";
import { DriveStoryScope } from "@/drive-core/stories/drive-story-scope";
import { withDarkTheme } from "@/drive-core/stories/drive-story-dark-theme";

const MODIFIED = new Date(2026, 9, 28, 12).getTime();

/** A small square photo, so the image tile shows a real thumbnail without a server. */
const PHOTO_URL =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#7cb7e8"/><rect y="40" width="64" height="24" fill="#5c9a4e"/><circle cx="46" cy="18" r="8" fill="#f6d36b"/></svg>',
  );

function storyFile(title: string, extra: Partial<DriveFile> = {}): DriveFile {
  return {
    id: title,
    title,
    category: "File",
    date: "",
    excerpt: "",
    body: [],
    notebook: "",
    tags: [],
    wordCount: 0,
    parent: "My Drive",
    kind: "file",
    size: "",
    location: "Personal",
    modifiedMs: MODIFIED,
    apiPath: `/users/admin/${title}`,
    ...extra,
  };
}

const ITEMS: DriveFile[] = [
  storyFile("Projects", { kind: "folder" }),
  storyFile("Quarterly plan.pdf", { kind: "doc", size: "1.2 MB" }),
  storyFile("Meeting notes.md", { kind: "doc", size: "4 KB", location: "Administrators" }),
  storyFile("Budget 2026.xlsx", { size: "88 KB" }),
  storyFile("Proposal.docx", { kind: "doc", size: "210 KB" }),
  storyFile("Assets.zip", { kind: "archive", size: "14 MB" }),
  storyFile("Launch teaser.mp4", { kind: "video", size: "48 MB" }),
  storyFile("Beach.png", { kind: "image", size: "2.0 MB" }),
  storyFile("README", { size: "1 KB" }),
];

const meta = {
  title: "Features/Drive/Components/DriveGridTiles",
  component: DriveGridView,
  tags: ["autodocs", "vitest-ci"],
  decorators: [
    (Story) => (
      <DriveStoryScope className="workspace-app-layout__main">
        <div style={{ width: 960 }}>
          <Story />
        </div>
      </DriveStoryScope>
    ),
  ],
  parameters: driveStoryParameters({
    componentDescription:
      "Grid tiles (suite file norm), shared by Drive and Docs: landscape cards with an avatar (image thumbnail, else the extension on its own colour, else the folder icon), the name, and a details line with location · size · last modified.",
    snippet: `<DriveGridView items={files} filePreviews={previews} showLocationColumn … />`,
  }),
  args: {
    ...createDriveBrowserStoryProps({
      items: ITEMS,
      starred: { "Proposal.docx": true },
      filePreviews: { "Beach.png": { kind: "blob-url", url: PHOTO_URL } },
    }),
    onMove: STORY_NOOP,
    showLocationColumn: true,
  },
} satisfies Meta<typeof DriveGridView>;

export default meta;
type Story = StoryObj<typeof meta>;

const tileFor = (canvasElement: HTMLElement, title: string) =>
  canvasElement.querySelector(`[data-drive-file-id="${title}"]`) as HTMLElement;

/** Each extension on its own colour; an image shows its thumbnail. */
export const Tiles: Story = {
  play: async ({ canvasElement }) => {
    const pdf = tileFor(canvasElement, "Quarterly plan.pdf");
    const avatar = pdf.querySelector(".drive-file-avatar--extension") as HTMLElement;
    await expect(avatar).toHaveTextContent("PDF");
    await expect(
      getComputedStyle(avatar).backgroundColor !==
        getComputedStyle(
          tileFor(canvasElement, "Budget 2026.xlsx").querySelector(
            ".drive-file-avatar",
          ) as HTMLElement,
        ).backgroundColor,
    ).toBe(true);

    await expect(
      tileFor(canvasElement, "Beach.png").querySelector(".drive-file-avatar--thumbnail img"),
    ).toHaveAttribute("src", PHOTO_URL);
    // No extension: the kind icon.
    await expect(
      tileFor(canvasElement, "README").querySelector(".drive-file-avatar--kind svg"),
    ).toBeInTheDocument();
  },
};

/** The details line: location, size and last modified side by side, in that order. */
export const DetailsLine: Story = {
  play: async ({ canvasElement }) => {
    const meta = tileFor(canvasElement, "Meeting notes.md").querySelector(".drive-tile-meta")!;
    const segments = Array.from(meta.querySelectorAll(".drive-tile-meta__segment")).map(
      (segment) => segment.textContent,
    );
    await expect(segments[0]).toBe("Administrators");
    await expect(segments[1]).toBe("4 KB");
    await expect(segments).toHaveLength(3);
    await expect(getComputedStyle(meta).display).toBe("flex");
    // Landscape: the avatar sits beside the name, not above it.
    const tile = tileFor(canvasElement, "Meeting notes.md").getBoundingClientRect();
    await expect(tile.width).toBeGreaterThan(tile.height * 2);
    // Folders have no size.
    await expect(
      within(canvasElement.querySelector('[aria-label="Folders"]') as HTMLElement).queryByText(
        /KB|MB/,
      ),
    ).not.toBeInTheDocument();
  },
};

/** Without a cross-drive view the location drops out of the details line. */
export const WithoutLocation: Story = {
  args: { showLocationColumn: false },
  play: async ({ canvasElement }) => {
    await expect(
      within(tileFor(canvasElement, "Meeting notes.md")).queryByText("Administrators"),
    ).not.toBeInTheDocument();
  },
};

/** Dark theme: the same hues on a deep wash with light ink. */
export const Dark: Story = {
  decorators: [withDarkTheme],
  play: async ({ canvasElement }) => {
    const avatar = tileFor(canvasElement, "Quarterly plan.pdf").querySelector(
      ".drive-file-avatar",
    ) as HTMLElement;
    await expect(getComputedStyle(avatar).backgroundColor).toContain(
      `0.33 0.06 ${extensionHue("pdf")}`,
    );
  },
};

/** The avatar alone, for every family. */
export const Avatars: Story = {
  render: () => (
    <div className="flex flex-wrap gap-3">
      {ITEMS.map((file) => (
        <DriveFileAvatar
          key={file.id}
          file={file}
          preview={file.kind === "image" ? { kind: "blob-url", url: PHOTO_URL } : undefined}
        />
      ))}
    </div>
  ),
};
