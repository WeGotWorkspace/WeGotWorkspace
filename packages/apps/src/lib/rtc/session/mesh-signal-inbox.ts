import type {
  HttpSignalingPollMessage,
  HttpSignalingPollResult,
} from "@/lib/rtc/signaling/http-client";
import { sortRtcSignalMessages } from "@/lib/rtc/types";

/** What the mesh does with a signal the inbox hands it. */
export type MeshSignalInboxPorts = {
  /** False drops the offer unanswered (lobby gate); the row is still acked. */
  shouldAcceptOffer?: (from: string) => boolean;
  handleOffer: (from: string, peerName: string, payload: unknown) => Promise<void>;
  handleAnswer: (from: string, payload: unknown) => Promise<void>;
  handleIce: (from: string, payload: unknown) => Promise<void>;
  handleBye: (from: string) => Promise<void>;
  /** Server hint that the other side asked for a relay. Poll, do not tear down. */
  handleRelayHint?: (from: string) => void;
  log: (event: string, details?: unknown) => void;
};

/**
 * Inbound mailbox for one mesh peer: the delivery cursor plus RTC signal
 * dispatch.
 *
 * The cursor is an acknowledgement, not a filter. It advances over *every*
 * delivered row — chat and control included, and whether or not RTC signals are
 * being handled at all — because the server keeps serving anything the cursor
 * has not reached. Skipping a row would let the server delete an offer, a chat
 * line, or an `admit` that this client never processed; stopping the cursor
 * would redeliver chat on every poll (#1086).
 */
export class MeshSignalInbox {
  private lastMsgId = 0;

  private readonly seenIds = new Set<number>();

  constructor(private readonly ports: MeshSignalInboxPorts) {}

  /** The `since` value to poll with: everything at or below it is acked. */
  cursor(): number {
    return this.lastMsgId;
  }

  reset(): void {
    this.lastMsgId = 0;
    this.seenIds.clear();
  }

  /**
   * Messages this inbox has not delivered yet. Ids are claimed immediately so a
   * send that piggybacks the same rows cannot apply them twice.
   */
  claim(messages: HttpSignalingPollMessage[]): HttpSignalingPollMessage[] {
    const fresh: HttpSignalingPollMessage[] = [];
    for (const message of messages) {
      if (typeof message.id === "number") {
        if (this.seenIds.has(message.id) || message.id <= this.lastMsgId) continue;
        this.seenIds.add(message.id);
        if (message.id > this.lastMsgId) this.lastMsgId = message.id;
      }
      fresh.push(message);
    }
    return fresh;
  }

  ack(messages: HttpSignalingPollMessage[]): void {
    for (const message of messages) {
      if (typeof message.id === "number" && message.id > this.lastMsgId) {
        this.lastMsgId = message.id;
      }
    }
  }

  /**
   * Hand the RTC signals of one poll to the mesh, in offer/answer/ice/bye order.
   * Chat and control rows are the caller's business (`onPollData`); they only
   * matter here because they move the cursor.
   */
  async applySignals(data: HttpSignalingPollResult): Promise<void> {
    const signals = sortRtcSignalMessages(
      data.messages.filter((message) => message.type !== "chat"),
    );
    for (const message of signals) {
      const peerName = data.peers.find((peer) => peer.id === message.from)?.name ?? "Peer";
      try {
        await this.dispatch(message, peerName);
      } catch (error) {
        this.ports.log("signal-handle-failed", {
          type: message.type,
          from: message.from,
          error,
        });
      }
    }
  }

  private async dispatch(message: HttpSignalingPollMessage, peerName: string): Promise<void> {
    if (message.type === "offer") {
      if (this.ports.shouldAcceptOffer && !this.ports.shouldAcceptOffer(message.from)) {
        this.ports.log("offer-ignored", { from: message.from, reason: "should-accept-false" });
        return;
      }
      await this.ports.handleOffer(message.from, peerName, message.payload);
      return;
    }
    if (message.type === "answer") {
      await this.ports.handleAnswer(message.from, message.payload);
      return;
    }
    if (message.type === "ice") {
      await this.ports.handleIce(message.from, message.payload);
      return;
    }
    if (message.type === "bye") {
      await this.ports.handleBye(message.from);
      return;
    }
    if (message.type === "relay-hint") {
      this.ports.handleRelayHint?.(message.from);
    }
  }
}
