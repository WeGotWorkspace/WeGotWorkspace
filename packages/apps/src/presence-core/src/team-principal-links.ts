import type {
  PrincipalLink,
  PrincipalLinkRegistry,
} from "@/lib/rtc/session/principal-link-registry";
import type { PrincipalLinkSink } from "@/presence-core/src/presence-rtc-session";

type RoomLinks = {
  links: Map<string, PrincipalLink>;
  connecting: ReadonlySet<string>;
  poller: (() => void) | null;
};

/**
 * Merges the principal links of several Team rooms into the one suite-level
 * registry (#1921). Each room session gets its own sink; a room's `retain`
 * only drops that room's links.
 *
 * Two users who share several Teams have a data channel in each of those
 * rooms. The registry gets the links of one room only: for each user, the
 * first room (by name) that has an open link to them. Both sides pick the same
 * room, so Docs reuse and Meet hints use one channel per tab, as with a single
 * room.
 */
export class TeamPrincipalLinks {
  private readonly rooms = new Map<string, RoomLinks>();

  /** Principal peer ids this merger registered, so it never drops anyone else's. */
  private readonly registered = new Set<string>();

  constructor(private readonly registry: PrincipalLinkRegistry) {}

  sinkFor(room: string): PrincipalLinkSink {
    const state = this.roomState(room);
    return {
      registerLink: (link) => {
        state.links.set(link.principalPeerId, link);
        this.sync();
      },
      retain: (liveIds) => {
        for (const id of [...state.links.keys()]) {
          if (!liveIds.has(id)) state.links.delete(id);
        }
        this.sync();
      },
      setConnectingUsernames: (usernames) => {
        state.connecting = new Set(usernames);
        this.sync();
      },
      setPrincipalPoller: (poll) => {
        state.poller = poll;
        this.syncPoller();
      },
      receive: (username, principalPeerId, payload) =>
        this.registry.receive(username, principalPeerId, payload),
      markSendFailed: (principalPeerId) => this.registry.markSendFailed(principalPeerId),
    };
  }

  /** The room is gone (Team left, session stopped): drop its links and poller. */
  removeRoom(room: string): void {
    if (!this.rooms.delete(room)) return;
    this.sync();
    this.syncPoller();
  }

  private roomState(room: string): RoomLinks {
    let state = this.rooms.get(room);
    if (!state) {
      state = { links: new Map(), connecting: new Set(), poller: null };
      this.rooms.set(room, state);
    }
    return state;
  }

  private sync(): void {
    const chosen = new Map<string, PrincipalLink>();
    const roomFor = new Map<string, string>();
    for (const room of [...this.rooms.keys()].sort()) {
      for (const link of this.rooms.get(room)?.links.values() ?? []) {
        const owner = roomFor.get(link.username);
        if (owner !== undefined && owner !== room) continue;
        roomFor.set(link.username, room);
        chosen.set(link.principalPeerId, link);
      }
    }

    for (const id of [...this.registered]) {
      if (chosen.has(id)) continue;
      this.registered.delete(id);
      this.registry.unregisterLink(id);
    }
    for (const [id, link] of chosen) {
      this.registered.add(id);
      this.registry.registerLink(link);
    }

    const connecting = new Set<string>();
    for (const state of this.rooms.values()) {
      for (const username of state.connecting) {
        if (!roomFor.has(username)) connecting.add(username);
      }
    }
    this.registry.setConnectingUsernames(connecting);
  }

  private syncPoller(): void {
    const pollers = [...this.rooms.values()]
      .map((state) => state.poller)
      .filter((poll): poll is () => void => poll !== null);
    this.registry.setPrincipalPoller(
      pollers.length === 0
        ? null
        : () => {
            for (const poll of pollers) poll();
          },
    );
  }
}
