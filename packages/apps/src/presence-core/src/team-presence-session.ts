import type { RtcPeerDescriptor } from "@/lib/rtc/types";
import type {
  PresenceEnvelope,
  PresenceMeshEvent,
  PresenceMeshSession,
} from "@/presence-core/src/presence-types";

/** One Team's presence room, as the composite session drives it. */
export type TeamRoomSession = PresenceMeshSession & {
  /** This tab's peer in the room, once joined (leave beacon). */
  ownPeers(): { room: string; peerId: string }[];
  /** Stretch the slow steady polls; see `PresenceRtcSession.setSteadyScale`. */
  setSteadyScale(scale: number): void;
};

export type TeamPresenceSessionOptions = {
  createRoomSession: (room: string) => TeamRoomSession;
  /** Called when a room is given up for good (Team left, session stopped), before its leave resolves. */
  onRoomRemoved?: (room: string) => void;
};

type RoomEntry = {
  session: TeamRoomSession;
  unsubscribe: () => void;
};

/**
 * Presence over one room per own Team (#1921). The presence store sees one
 * session: peers of every room in one list, so its roster merges them by
 * username like the tabs of one user. `setRooms` follows the Team list; rooms
 * added after `join` are joined at once, removed rooms are left.
 *
 * All rooms together poll at most twice as often as one room: each room's slow
 * steady cadence is stretched by `max(1, rooms / 2)`.
 */
export class TeamPresenceSession implements PresenceMeshSession {
  private readonly rooms = new Map<string, RoomEntry>();

  private readonly listeners = new Set<(event: PresenceMeshEvent) => void>();

  /** Display name once `join` was called; rooms added later join with it. */
  private joinName: string | null = null;

  private left = false;

  constructor(private readonly options: TeamPresenceSessionOptions) {}

  /** Room tokens (`groups.{slug}`) currently held, sorted. */
  roomNames(): string[] {
    return [...this.rooms.keys()].sort();
  }

  /** Follow the Team list: join new rooms, leave rooms of Teams the user left. */
  setRooms(next: readonly string[]): void {
    if (this.left) return;
    const wanted = new Set(next);
    let changed = false;
    for (const room of [...this.rooms.keys()]) {
      if (wanted.has(room)) continue;
      void this.removeRoom(room);
      changed = true;
    }
    for (const room of wanted) {
      if (this.rooms.has(room)) continue;
      this.addRoom(room);
      changed = true;
    }
    if (!changed) return;
    this.applySteadyScale();
    this.emit({ type: "roster" });
  }

  async join(name: string): Promise<{ peerId: string; superseded?: true }> {
    this.joinName = name;
    const entries = [...this.rooms.values()];
    if (entries.length === 0) return { peerId: "" };
    const results = await Promise.allSettled(entries.map((entry) => entry.session.join(name)));
    // A room that refused the join is dropped, so the next Team-list check adds it again.
    results.forEach((result, index) => {
      if (result.status === "rejected") void this.dropIfCurrent(entries[index].session);
    });
    const joined = results.flatMap((result) =>
      result.status === "fulfilled" && !result.value.superseded ? [result.value] : [],
    );
    if (joined.length > 0) return { peerId: joined[0].peerId };
    if (results.every((result) => result.status === "fulfilled")) {
      return { peerId: "", superseded: true };
    }
    const failed = results.find((result) => result.status === "rejected");
    throw failed && failed.status === "rejected" ? failed.reason : new Error("join failed");
  }

  async leave(): Promise<void> {
    this.left = true;
    this.joinName = null;
    const rooms = [...this.rooms.keys()];
    await Promise.all(rooms.map((room) => this.removeRoom(room)));
  }

  broadcast(envelope: PresenceEnvelope): void {
    for (const { session } of this.rooms.values()) session.broadcast(envelope);
  }

  sendTo(peerId: string, envelope: PresenceEnvelope): void {
    this.roomOfPeer(peerId)?.sendTo(peerId, envelope);
  }

  getRoomPeers(): RtcPeerDescriptor[] {
    return [...this.rooms.values()].flatMap(({ session }) => session.getRoomPeers());
  }

  /** The user's peers in the first room (by name) that has any: one copy per tab. */
  peersForUsername(username: string): RtcPeerDescriptor[] {
    const key = username.trim().toLowerCase();
    for (const room of this.roomNames()) {
      const peers = this.rooms
        .get(room)!
        .session.getRoomPeers()
        .filter((peer) => (peer.user ?? "").trim().toLowerCase() === key);
      if (peers.length > 0) return peers;
    }
    return [];
  }

  isLinked(peerId: string): boolean {
    return this.roomOfPeer(peerId)?.isLinked(peerId) ?? false;
  }

  ownPeers(): { room: string; peerId: string }[] {
    return [...this.rooms.values()].flatMap(({ session }) => session.ownPeers());
  }

  onEvent(listener: (event: PresenceMeshEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private addRoom(room: string): void {
    const session = this.options.createRoomSession(room);
    const unsubscribe = session.onEvent((event) => this.emit(event));
    this.rooms.set(room, { session, unsubscribe });
    if (this.joinName !== null) {
      void session.join(this.joinName).catch(() => this.dropIfCurrent(session));
    }
  }

  private async dropIfCurrent(session: TeamRoomSession): Promise<void> {
    for (const [room, entry] of this.rooms) {
      if (entry.session !== session) continue;
      await this.removeRoom(room);
      this.applySteadyScale();
      this.emit({ type: "roster" });
      return;
    }
  }

  private async removeRoom(room: string): Promise<void> {
    const entry = this.rooms.get(room);
    if (!entry) return;
    this.rooms.delete(room);
    entry.unsubscribe();
    // Before the await: a room re-added meanwhile must not lose its fresh links to this call.
    this.options.onRoomRemoved?.(room);
    await entry.session.leave();
  }

  private applySteadyScale(): void {
    const scale = Math.max(1, this.rooms.size / 2);
    for (const { session } of this.rooms.values()) session.setSteadyScale(scale);
  }

  private roomOfPeer(peerId: string): TeamRoomSession | null {
    for (const { session } of this.rooms.values()) {
      if (session.getRoomPeers().some((peer) => peer.id === peerId)) return session;
    }
    return null;
  }

  private emit(event: PresenceMeshEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}
