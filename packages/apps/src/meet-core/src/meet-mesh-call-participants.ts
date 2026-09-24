export function applyMeetMeshCallParticipant(
  current: Record<string, string[]>,
  args: { channelId: string; senderUsername: string; active: boolean },
): Record<string, string[]> {
  const sender = args.senderUsername.trim();
  if (!sender) return current;
  const existing = current[args.channelId] ?? [];
  if (args.active) {
    if (existing.includes(sender)) return current;
    return { ...current, [args.channelId]: [...existing, sender] };
  }
  if (!(args.channelId in current)) return current;
  const next = existing.filter((username) => username !== sender);
  if (next.length === existing.length) return current;
  if (next.length === 0) {
    // Keep an empty set so merge can tell "mesh says ended" from "mesh never saw this channel".
    return { ...current, [args.channelId]: [] };
  }
  return { ...current, [args.channelId]: next };
}

export function applyMeetMeshCallAudioOnly(
  current: Record<string, boolean>,
  args: {
    channelId: string;
    active: boolean;
    audioOnly?: boolean;
    remainingParticipants: number;
  },
): Record<string, boolean> {
  if (args.active) {
    if (args.audioOnly === true) {
      if (current[args.channelId] === true) return current;
      return { ...current, [args.channelId]: true };
    }
    if (!(args.channelId in current)) return current;
    const { [args.channelId]: _dropped, ...rest } = current;
    return rest;
  }
  if (args.remainingParticipants > 0) return current;
  if (!(args.channelId in current)) return current;
  const { [args.channelId]: _dropped, ...rest } = current;
  return rest;
}

export type MeetMeshCallState = {
  participants: Record<string, string[]>;
  audioOnly: Record<string, boolean>;
};

export function applyMeetMeshCallEvent(
  current: MeetMeshCallState,
  args: {
    channelId: string;
    senderUsername?: string;
    active: boolean;
    audioOnly?: boolean;
  },
): MeetMeshCallState {
  const participants = args.senderUsername
    ? applyMeetMeshCallParticipant(current.participants, {
        channelId: args.channelId,
        senderUsername: args.senderUsername,
        active: args.active,
      })
    : current.participants;
  const audioOnly = applyMeetMeshCallAudioOnly(current.audioOnly, {
    channelId: args.channelId,
    active: args.active,
    audioOnly: args.audioOnly,
    remainingParticipants: participants[args.channelId]?.length ?? 0,
  });
  if (participants === current.participants && audioOnly === current.audioOnly) return current;
  return { participants, audioOnly };
}

export function meetMeshCallActiveFromParticipants(
  participants: Record<string, string[]>,
): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const [channelId, usernames] of Object.entries(participants)) {
    if (usernames.length > 0) out[channelId] = true;
  }
  return out;
}
