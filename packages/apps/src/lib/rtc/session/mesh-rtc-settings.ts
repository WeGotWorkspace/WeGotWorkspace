import { applyRtcDebugOverrides } from "@/lib/rtc/force-relay";
import type { RtcSettings, SignalingChannel } from "@/lib/rtc/types";

export type MeshRtcSettingsPorts = {
  channel: SignalingChannel;
  initial: RtcSettings;
  /** Read the room configuration once a join has produced a session key. */
  refresh?: (input: { sessionKey: string }) => Promise<RtcSettings | null>;
  onApplied?: (settings: RtcSettings) => void;
  log: (event: string, details?: unknown) => void;
};

function sameSettings(a: RtcSettings, b: RtcSettings): boolean {
  return (
    a.stunUrls === b.stunUrls &&
    a.turnAvailable === b.turnAvailable &&
    a.forceRelay === b.forceRelay
  );
}

/**
 * The live ICE settings of one mesh. Everything that dials — the peer dialer,
 * the relay, the net probe — reads `current()` at call time instead of holding
 * the object it was built with, so settings that arrive after the mesh exists
 * still reach the next dial.
 *
 * Guest Meet is why this exists (#1219): an anonymous bootstrap cannot read
 * `GET /rooms/{id}/configuration`, so a guest's first real settings only arrive
 * once a join has minted a session key — which is still before the first dial.
 */
export class MeshRtcSettings {
  private settings: RtcSettings;

  private refreshedKey: string | null = null;

  constructor(private readonly ports: MeshRtcSettingsPorts) {
    this.settings = this.resolve(ports.initial);
  }

  current(): RtcSettings {
    return this.settings;
  }

  /**
   * Meet, collab and principal all honor admin/test forced relay. Principal used
   * to clear the flag, so its peer connection stayed on `iceTransportPolicy: all`.
   * Re-applied on every update, not only at construction.
   */
  private resolve(settings: RtcSettings): RtcSettings {
    const channel = this.ports.channel;
    return channel === "meet" || channel === "collab" || channel === "principal"
      ? applyRtcDebugOverrides(settings)
      : settings;
  }

  /** True when the mesh now runs on different settings than before. */
  apply(next: RtcSettings): boolean {
    const resolved = this.resolve(next);
    if (sameSettings(this.settings, resolved)) return false;
    this.settings = resolved;
    this.ports.log("rtc-settings-applied", {
      stunUrls: resolved.stunUrls,
      turnAvailable: resolved.turnAvailable,
      forceRelay: resolved.forceRelay,
    });
    this.ports.onApplied?.(resolved);
    return true;
  }

  /**
   * Once per session key after a real answer, and never fatal. Null and a
   * rejection both keep the settings the mesh already had and leave the key
   * free to try again, so a join never fails on the configuration request.
   */
  async adoptSessionKey(sessionKey: string): Promise<void> {
    if (!this.ports.refresh || this.refreshedKey === sessionKey) return;
    this.refreshedKey = sessionKey;
    try {
      const next = await this.ports.refresh({ sessionKey });
      if (!next) {
        this.refreshedKey = null;
        return;
      }
      this.ports.log("rtc-settings-refresh", {
        changed: this.apply(next),
        turnAvailable: next.turnAvailable,
      });
    } catch (error) {
      this.refreshedKey = null;
      this.ports.log("rtc-settings-refresh-failed", { error });
    }
  }
}
