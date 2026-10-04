import {
  clampVideoProfile,
  normalizeVideoProfile,
  VIDEO_PROFILE_SPECS,
  type VideoProfile,
} from "@/lib/rtc/video-profile";

/** Capture height the camera constraint asks for. Scale is relative to this. */
const CAMERA_CAPTURE_HEIGHT = 720;

export const CAMERA_MAX_FRAMERATE = 24;

export type ScreenOptimize = "text" | "video";

export type VideoLimits = {
  maxVideoProfile: VideoProfile;
  maxVideoProfileRelay: VideoProfile;
};

export const DEFAULT_VIDEO_LIMITS: VideoLimits = {
  maxVideoProfile: "p720",
  maxVideoProfileRelay: "p360",
};

/** Instance ceiling `audio` means this client must not send a camera. */
export function cameraMaxProfileIsAudio(limits: VideoLimits): boolean {
  return limits.maxVideoProfile === "audio";
}

export function videoLimitsFromJoin(value: unknown): VideoLimits {
  if (!value || typeof value !== "object") return DEFAULT_VIDEO_LIMITS;
  const limits = (
    value as { limits?: { maxVideoProfile?: unknown; maxVideoProfileRelay?: unknown } }
  ).limits;
  return {
    maxVideoProfile: normalizeVideoProfile(limits?.maxVideoProfile, "p720"),
    maxVideoProfileRelay: normalizeVideoProfile(limits?.maxVideoProfileRelay, "p360"),
  };
}

/** One remote peer sends 720p. Two or three send 360p. */
export function profileForPeerCount(remotePeers: number): VideoProfile {
  return remotePeers <= 1 ? "p720" : "p360";
}

/**
 * The profile a sender may use: the automatic pick, then every ceiling. The
 * minimum wins, so none of the caps can raise another.
 */
export function effectiveSendProfile(input: {
  remotePeers: number;
  limits: VideoLimits;
  relayed: boolean;
  lowData: boolean;
}): VideoProfile {
  let profile = profileForPeerCount(input.remotePeers);
  profile = clampVideoProfile(profile, input.limits.maxVideoProfile);
  if (input.relayed) profile = clampVideoProfile(profile, input.limits.maxVideoProfileRelay);
  if (input.lowData) profile = clampVideoProfile(profile, "p180");
  return profile;
}

export function screenMaxFramerate(mode: ScreenOptimize, lowData: boolean): number {
  if (lowData) return 4;
  return mode === "video" ? 24 : 8;
}

export function screenContentHint(mode: ScreenOptimize): "detail" | "motion" {
  return mode === "video" ? "motion" : "detail";
}

export function screenDegradation(mode: ScreenOptimize): RTCDegradationPreference {
  return mode === "video" ? "maintain-framerate" : "maintain-resolution";
}

export type SenderApply = {
  profile: VideoProfile;
  screen: boolean;
  screenMode: ScreenOptimize;
  lowData: boolean;
};

/** `getStats` selected pair is a relay. Re-run after every ICE restart. */
export async function selectedPairIsRelay(pc: RTCPeerConnection): Promise<boolean> {
  const stats = await pc.getStats();
  let relay = false;
  stats.forEach((report) => {
    if (report.type !== "candidate-pair") return;
    const pair = report as RTCStats & {
      selected?: boolean;
      nominated?: boolean;
      localCandidateId?: string;
    };
    if (!pair.selected && !pair.nominated) return;
    const local = pair.localCandidateId ? stats.get(pair.localCandidateId) : undefined;
    const kind = local && "candidateType" in local ? String(local.candidateType) : "";
    if (kind === "relay") relay = true;
  });
  return relay;
}

/**
 * Encoding parameters only. No new offer: `setParameters` does not renegotiate.
 * `audio` stops the camera track instead of sending a black frame.
 */
export async function applyVideoSender(sender: RTCRtpSender, apply: SenderApply): Promise<void> {
  const track = sender.track;
  if (!track || track.kind !== "video") return;

  if (!apply.screen && apply.profile === "audio") {
    track.enabled = false;
    return;
  }
  track.enabled = true;

  const spec = VIDEO_PROFILE_SPECS[apply.screen ? apply.profile : apply.profile];
  const params = sender.getParameters();
  if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
  const encoding = params.encodings[0] ?? {};
  params.encodings[0] = encoding;

  if (apply.screen) {
    track.contentHint = screenContentHint(apply.screenMode);
    encoding.maxFramerate = screenMaxFramerate(apply.screenMode, apply.lowData);
    params.degradationPreference = screenDegradation(apply.screenMode);
    const height = apply.screenMode === "video" ? 720 : spec.height;
    encoding.scaleResolutionDownBy =
      height && height < CAMERA_CAPTURE_HEIGHT ? CAMERA_CAPTURE_HEIGHT / height : 1;
    if (spec.maxBitrate) encoding.maxBitrate = spec.maxBitrate;
  } else if (spec.height && spec.maxBitrate) {
    encoding.maxBitrate = spec.maxBitrate;
    encoding.maxFramerate = CAMERA_MAX_FRAMERATE;
    encoding.scaleResolutionDownBy =
      spec.height < CAMERA_CAPTURE_HEIGHT ? CAMERA_CAPTURE_HEIGHT / spec.height : 1;
  }

  await sender.setParameters(params);
}

export async function applyPeerVideoSenders(
  pc: RTCPeerConnection,
  input: Omit<SenderApply, "screen"> & { screenTrackId?: string | null },
): Promise<void> {
  await Promise.all(
    pc
      .getSenders()
      .filter((sender) => sender.track?.kind === "video")
      .map((sender) =>
        applyVideoSender(sender, {
          ...input,
          screen: Boolean(input.screenTrackId) && sender.track?.id === input.screenTrackId,
        }),
      ),
  );
}

/** Low-data receive cap: the first peers, in a stable order, keep video. */
export function lowDataVideoPeerIds(peerIds: readonly string[], limit = 2): Set<string> {
  return new Set([...peerIds].sort().slice(0, limit));
}
