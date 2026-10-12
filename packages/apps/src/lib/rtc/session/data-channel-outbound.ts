import {
  DATA_CHANNEL_BUFFER_HIGH_WATER_BYTES,
  encodeBinaryFrames,
} from "@/lib/rtc/session/data-channel-frames";

/**
 * Sends one peer's data-channel messages. Binary peers get 16 KiB frames.
 * Everyone else still gets one JSON string. Sending pauses while
 * `bufferedAmount` is above 1 MiB and resumes on `bufferedamountlow`.
 */
export class DataChannelOutbound {
  private nextMessageId = 1;

  private readonly queue: Array<string | Uint8Array> = [];

  private flushing = false;

  private waiting = false;

  constructor(
    private readonly channel: RTCDataChannel,
    private readonly onFailed: (error: unknown) => void,
  ) {}

  owns(channel: RTCDataChannel): boolean {
    return this.channel === channel;
  }

  sendJson(message: unknown, binary: boolean): void {
    if (this.channel.readyState !== "open") return;
    try {
      if (!binary) {
        this.enqueue(JSON.stringify(message));
        return;
      }
      const bytes = new TextEncoder().encode(JSON.stringify(message));
      const messageId = this.nextMessageId;
      this.nextMessageId = (this.nextMessageId + 1) >>> 0;
      if (this.nextMessageId === 0) this.nextMessageId = 1;
      for (const frame of encodeBinaryFrames(bytes, messageId)) this.enqueue(frame);
    } catch (error) {
      this.queue.length = 0;
      this.onFailed(error);
    }
  }

  private enqueue(data: string | Uint8Array): void {
    this.queue.push(data);
    this.flush();
  }

  private flush(): void {
    if (this.flushing || this.waiting) return;
    this.flushing = true;
    try {
      while (this.queue.length > 0) {
        if (this.channel.bufferedAmount > DATA_CHANNEL_BUFFER_HIGH_WATER_BYTES) {
          this.pause();
          return;
        }
        const next = this.queue[0];
        if (next === undefined) return;
        try {
          if (typeof next === "string") this.channel.send(next);
          else this.channel.send(new Uint8Array(next));
        } catch (error) {
          this.queue.length = 0;
          this.onFailed(error);
          return;
        }
        this.queue.shift();
      }
    } finally {
      this.flushing = false;
    }
  }

  private pause(): void {
    if (this.waiting) return;
    this.waiting = true;
    this.channel.bufferedAmountLowThreshold = DATA_CHANNEL_BUFFER_HIGH_WATER_BYTES;
    const resume = (): void => {
      this.channel.removeEventListener("bufferedamountlow", resume);
      this.waiting = false;
      this.flush();
    };
    this.channel.addEventListener("bufferedamountlow", resume);
  }
}
