import type { DriveFile } from "@/lib/files/drive-models";

/** Markdown + plain-text samples for Drive/Docs Storybook (double-click opens Docs). */
export const DRIVE_DOCS_EDITOR_STORY_FILES: DriveFile[] = [
  {
    id: "f-project-brief-md",
    notebook: "Doc · 12 KB",
    category: "Document",
    date: "Today",
    title: "Project Brief.md",
    excerpt: "Opens in Docs with formatting toolbar",
    body: ["Markdown brief for the autumn issue."],
    tags: ["editorial"],
    wordCount: 0,
    parent: "My Drive",
    kind: "doc",
    size: "12 KB",
    apiPath: "/users/demo/Project Brief.md",
  },
  {
    id: "f-meeting-notes-txt",
    notebook: "Doc · 2 KB",
    category: "Document",
    date: "Today",
    title: "Meeting Notes.txt",
    excerpt: "Opens in Docs without the formatting toolbar",
    body: ["Plain-text meeting notes."],
    tags: [],
    wordCount: 0,
    parent: "My Drive",
    kind: "doc",
    size: "2 KB",
    apiPath: "/users/demo/meeting-notes.txt",
  },
];
