import { wgwApiBaseUrl } from "@/lib/api/wgw/http";
import { encodeFileRoomId } from "@/lib/rtc/room-id";

export type DocsCollabUrls = {
  /** Canonical collab room: the drive path without its leading slash. */
  room: string;
  roomId: string;
  signalUrl: string;
  collabApiBaseUrl: string;
  collabRtcUrl: string;
  documentUrl: string;
  yjsUrl: string;
};

/**
 * Collab endpoints for a drive path. Accents, parentheses and `&` have to survive
 * both the `/rooms/{roomId}` segment (base64url of the UTF-8 path) and the
 * `?path=` query, so neither is interpolated raw.
 */
export function buildDocsCollabUrls(filePath: string): DocsCollabUrls {
  const baseUrl = wgwApiBaseUrl();
  const room = filePath.replace(/^\/+/, "");
  const roomId = encodeFileRoomId(room);
  const pathQuery = encodeURIComponent(room);
  return {
    room,
    roomId,
    signalUrl: `${baseUrl}/rooms/${encodeURIComponent(roomId)}/events`,
    collabApiBaseUrl: `${baseUrl}/rooms`,
    collabRtcUrl: `${baseUrl}/rooms/${encodeURIComponent(roomId)}/configuration`,
    documentUrl: `${baseUrl}/files/collaboration?path=${pathQuery}`,
    yjsUrl: `${baseUrl}/files/collaboration?path=${pathQuery}&format=yjs`,
  };
}
