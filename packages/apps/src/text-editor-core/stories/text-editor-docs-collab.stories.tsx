import type { Meta, StoryObj } from "@storybook/react-vite";
import { DocsCollabWorkspace } from "@/text-editor-core/docs-collab";
import { createWgwDocsCollabWire } from "@/docs-core/src/docs-collab-wgw-wire";
import { encodeFileRoomId } from "@/lib/rtc/room-id";

import "@/text-editor-core/src/text-editor.css";

const devUser = (import.meta.env.VITE_WGW_DEV_USERNAME as string | undefined) ?? "admin";
const devPassword =
  (import.meta.env.VITE_WGW_DEV_PASSWORD as string | undefined) ?? "storybook-dev";
const liveApiOrigin =
  (import.meta.env.VITE_WGW_LIVE_ORIGIN as string | undefined)?.trim() ||
  "https://wegotworkspace.localhost";
const defaultRoom = "/users/admin/docs-collab-room.md";

function collabStoryUrls(room: string) {
  const roomId = encodeFileRoomId(room);
  const pathQuery = encodeURIComponent(room);
  return {
    signalUrl: `${liveApiOrigin}/api/v1/rooms/${encodeURIComponent(roomId)}/events`,
    collabApiBaseUrl: `${liveApiOrigin}/api/v1/rooms`,
    collabRtcUrl: `${liveApiOrigin}/api/v1/rooms/${encodeURIComponent(roomId)}/configuration`,
    authTokenUrl: `${liveApiOrigin}/api/v1/auth/token`,
    authUser: devUser,
    authPassword: devPassword,
    documentUrl: `${liveApiOrigin}/api/v1/files/collaboration?path=${pathQuery}`,
    yjsUrl: `${liveApiOrigin}/api/v1/files/collaboration?path=${pathQuery}&format=yjs`,
    documentSaveMethod: "PUT" as const,
    room,
  };
}

const storyDescription = `
Collaborative markdown editing over artifact-based REST endpoints.

- Signaling: \`/api/v1/rooms/{roomId}/participants|events\`
- Document: \`/api/v1/files/collaboration?path=\`
- Sync: Yjs over WebRTC data channels.

### Run

1. \`pnpm dev\` (Storybook on :6006, full app on :5173)
2. Ensure \`.env.local\` has valid \`VITE_WGW_DEV_USERNAME\`, \`VITE_WGW_DEV_PASSWORD\`, and \`VITE_WGW_LIVE_ORIGIN\`.
3. Open this story in two windows with different names to test collaboration.
`;

const meta = {
  title: "Features/Docs/TextEditor/Docs collab",
  component: DocsCollabWorkspace,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component: storyDescription,
      },
    },
  },
} satisfies Meta<typeof DocsCollabWorkspace>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Collab: Story = {};

const liveCollabWire = createWgwDocsCollabWire();

export const CollabLaravelFinalApiAuth: Story = {
  args: {
    userName: "Admin User",
    urls: collabStoryUrls(defaultRoom),
    wire: liveCollabWire,
  },
  parameters: {
    docs: {
      description: {
        story:
          "Signaling uses `/rooms/{roomId}/*` and document persistence uses `/files/collaboration?path=` with JWT auth.",
      },
    },
  },
};

const isolatedRoom = "/users/admin/docs-collab-room-isolated.md";

export const CollabLaravelFinalApiAuthIsolatedRoom: Story = {
  args: {
    urls: collabStoryUrls(isolatedRoom),
    wire: liveCollabWire,
  },
  parameters: {
    docs: {
      description: {
        story:
          "Step 2.4 room isolation audit: this story uses the final APIs with a different room. " +
          "Tabs opened on this story should sync with each other but stay isolated from `docs-collab-room.md`.",
      },
    },
  },
};
