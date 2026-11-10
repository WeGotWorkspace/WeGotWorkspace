import { wgwApiBaseUrl, wgwCurrentAccessToken, wgwFetch, wgwReadJson } from "@/lib/api/wgw/http";
import { fetchRtcSettings } from "@/lib/api/wgw/rtc";
import { resolveRoomId } from "@/lib/rtc/room-id";
import type { RtcSettings } from "@/lib/rtc/types";
import { presenceGroupRoom } from "@/presence-core/src/presence-types";

const GROUP_PRINCIPAL_PREFIX = "principals/groups/";

/** Re-read the Team list at most this often from the slow timer (#1921). */
export const TEAM_CHECK_INTERVAL_MS = 5 * 60_000;

/** Event-driven checks (tab shown, back online, a room refused us) wait at least this long. */
export const TEAM_CHECK_MIN_GAP_MS = 10_000;

/** Presence room tokens for the Teams in a `settings/state` answer, sorted. */
export function teamRoomsFromSettingsState(state: unknown): string[] {
  const groups = (state as { groups?: unknown } | null)?.groups;
  if (!Array.isArray(groups)) return [];
  const rooms = new Set<string>();
  for (const group of groups) {
    const id = (group as { id?: unknown } | null)?.id;
    if (typeof id !== "string" || !id.startsWith(GROUP_PRINCIPAL_PREFIX)) continue;
    const slug = id.slice(GROUP_PRINCIPAL_PREFIX.length);
    if (slug) rooms.add(presenceGroupRoom(slug));
  }
  return [...rooms].sort();
}

/** The caller's own Teams as presence rooms. Throws when the API cannot be reached. */
export async function fetchOwnTeamRooms(): Promise<string[]> {
  const res = await wgwFetch("/settings/state");
  if (!res.ok) throw new Error(`GET /settings/state failed (${res.status})`);
  return teamRoomsFromSettingsState(await wgwReadJson(res));
}

/** RTC settings are the same for every room; ask through a room the caller may use. */
export function fetchTeamRoomRtcSettings(room: string): Promise<RtcSettings> {
  const roomId = resolveRoomId("principal", room);
  return fetchRtcSettings({
    url: `${wgwApiBaseUrl()}/rooms/${encodeURIComponent(roomId)}/configuration`,
    bearerToken: wgwCurrentAccessToken() ?? undefined,
  });
}
