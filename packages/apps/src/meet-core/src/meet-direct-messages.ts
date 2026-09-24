import type { CollectionSharePrincipal } from "@/share-ui/collection-share";

export const MEET_DM_CHANNEL_PREFIX = "dm:";

export type MeetDirectMessagePerson = {
  id: string;
  displayName: string;
  channelId: string;
  unreadCount?: number;
};

export function meetDirectMessageChannelId(principalId: string): string {
  return `${MEET_DM_CHANNEL_PREFIX}${principalId}`;
}

export function isMeetDirectMessageChannelId(id: string | null | undefined): boolean {
  return Boolean(id?.startsWith(MEET_DM_CHANNEL_PREFIX));
}

export function meetDirectMessagePrincipalId(channelId: string): string | null {
  if (!isMeetDirectMessageChannelId(channelId)) return null;
  const principalId = channelId.slice(MEET_DM_CHANNEL_PREFIX.length);
  return principalId || null;
}

export function meetDirectMessagePeople(
  directory: readonly CollectionSharePrincipal[] | undefined,
  options?: {
    excludeId?: string | null;
    unreadByPrincipalId?: Readonly<Record<string, number>>;
  },
): MeetDirectMessagePerson[] {
  const excludeId = options?.excludeId;
  const unread = options?.unreadByPrincipalId ?? {};
  return (directory ?? [])
    .filter((principal) => principal.principalType === "user" && principal.id !== excludeId)
    .map((principal) => {
      const unreadCount = unread[principal.id];
      return {
        id: principal.id,
        displayName: principal.displayName,
        channelId: meetDirectMessageChannelId(principal.id),
        unreadCount: unreadCount && unreadCount > 0 ? unreadCount : undefined,
      };
    });
}

export function findMeetDirectMessagePerson(
  people: readonly MeetDirectMessagePerson[],
  channelId: string | null,
): MeetDirectMessagePerson | null {
  if (!channelId) return null;
  return people.find((person) => person.channelId === channelId) ?? null;
}
