import type { RtcLinkState } from "@/lib/rtc/types";

export type MediaBindingOptions = {
  getLocalStream: () => MediaStream | null;
  onRemoteStream?: (remoteId: string, stream: MediaStream) => void;
};

export function createMediaBinding(options: MediaBindingOptions) {
  return {
    kind: "media" as const,
    attach(pc: RTCPeerConnection, remoteId: string): MediaStream {
      const localStream = options.getLocalStream();
      if (localStream) {
        for (const track of localStream.getTracks()) {
          pc.addTrack(track, localStream);
        }
      }
      const remoteStream = new MediaStream();
      pc.ontrack = (event) => {
        const track = event.track;
        if (track && !remoteStream.getTracks().includes(track)) {
          remoteStream.addTrack(track);
        }
        event.streams[0]?.getTracks().forEach((t) => {
          if (!remoteStream.getTracks().includes(t)) {
            remoteStream.addTrack(t);
          }
        });
        options.onRemoteStream?.(remoteId, remoteStream);
      };
      return remoteStream;
    },
  };
}

export type DataBindingOptions = {
  label: string;
  onOpen?: (remoteId: string, channel: RTCDataChannel) => void;
  onMessage?: (remoteId: string, data: string) => void;
  onClose?: (remoteId: string) => void;
};

export function createDataBinding(options: DataBindingOptions) {
  const attachChannel = (remoteId: string, channel: RTCDataChannel) => {
    channel.onopen = () => options.onOpen?.(remoteId, channel);
    channel.onclose = () => options.onClose?.(remoteId);
    channel.onmessage = (event) => options.onMessage?.(remoteId, String(event.data));
    return channel;
  };

  return {
    kind: "data" as const,
    label: options.label,
    attachInitiator(pc: RTCPeerConnection, remoteId: string): RTCDataChannel {
      return attachChannel(remoteId, pc.createDataChannel(options.label));
    },
    attachReceiver(
      pc: RTCPeerConnection,
      remoteId: string,
      onChannel?: (channel: RTCDataChannel) => void,
    ): void {
      pc.ondatachannel = (event) => {
        if (event.channel.label !== options.label) return;
        onChannel?.(event.channel);
        attachChannel(remoteId, event.channel);
      };
    },
    linkState(channel: RTCDataChannel | null, pc: RTCPeerConnection): RtcLinkState {
      if (channel?.readyState === "open") return "connected";
      const ice = pc.iceConnectionState;
      if (ice === "connected" || ice === "completed") return "connecting";
      if (ice === "failed") return "failed";
      if (ice === "disconnected") return "disconnected";
      if (ice === "closed") return "closed";
      return "connecting";
    },
  };
}

export type RtcSessionBinding =
  ReturnType<typeof createMediaBinding> | ReturnType<typeof createDataBinding>;
