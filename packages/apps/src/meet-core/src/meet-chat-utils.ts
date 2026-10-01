type AudioContextCtor = typeof AudioContext;

type WebkitAudioWindow = Window & { webkitAudioContext?: AudioContextCtor };

let sharedContext: AudioContext | null = null;

function audioContextConstructor(): AudioContextCtor | undefined {
  if (typeof window === "undefined") return undefined;
  return window.AudioContext || (window as WebkitAudioWindow).webkitAudioContext;
}

/**
 * One context for the knock chime. Creating a fresh context on each knock
 * starts suspended outside a user gesture, so the tones never become audible.
 */
function meetKnockAudioContext(): AudioContext | null {
  const AudioCtx = audioContextConstructor();
  if (!AudioCtx) return null;
  if (sharedContext && sharedContext.state !== "closed") return sharedContext;
  try {
    sharedContext = new AudioCtx();
  } catch {
    sharedContext = null;
  }
  return sharedContext;
}

/** Drops the shared context between Vitest cases. */
export function resetMeetKnockSoundForTests(): void {
  const current = sharedContext;
  sharedContext = null;
  if (!current || current.state === "closed") return;
  void current.close().catch(() => {
    // Ignore close race errors.
  });
}

/** Resume during a click or keypress so a later knock is allowed to play. */
export function primeMeetKnockSound(): void {
  const context = meetKnockAudioContext();
  if (!context || context.state !== "suspended") return;
  void context.resume().catch(() => {
    // Autoplay policy refused; the next gesture can try again.
  });
}

function scheduleMeetKnockTones(context: AudioContext): void {
  const now = context.currentTime;
  const gain = context.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.16, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);
  gain.connect(context.destination);

  const toneA = context.createOscillator();
  toneA.type = "sine";
  toneA.frequency.setValueAtTime(740, now);
  toneA.connect(gain);
  toneA.start(now);
  toneA.stop(now + 0.16);

  const toneB = context.createOscillator();
  toneB.type = "sine";
  toneB.frequency.setValueAtTime(988, now + 0.18);
  toneB.connect(gain);
  toneB.start(now + 0.18);
  toneB.stop(now + 0.38);
}

export function playMeetKnockSound(): void {
  const context = meetKnockAudioContext();
  if (!context) return;
  const start = () => {
    if (context.state === "closed") return;
    scheduleMeetKnockTones(context);
  };
  if (context.state === "suspended") {
    void context
      .resume()
      .then(() => {
        if (context.state === "running") start();
      })
      .catch(() => {
        // Stay silent when the browser still blocks audio.
      });
    return;
  }
  start();
}
