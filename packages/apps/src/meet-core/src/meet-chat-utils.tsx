import { CHAT_URL_SPLIT_PATTERN } from "@/meet-core/src/meet-chat-urls";

export function formatMeetChatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function renderMeetChatBody(text: string) {
  const parts = text.split(CHAT_URL_SPLIT_PATTERN);
  return parts.map((part, index) => {
    if (!part) return null;
    const isUrl = /^(?:https?:\/\/|www\.)/i.test(part);
    if (!isUrl) return <span key={`txt-${index}`}>{part}</span>;
    const href = /^https?:\/\//i.test(part) ? part : `https://${part}`;
    return (
      <a
        key={`lnk-${index}`}
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        className="meet-chat__link"
      >
        {part}
      </a>
    );
  });
}

export function playMeetKnockSound() {
  const AudioCtx =
    window.AudioContext ||
    (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return;
  const context = new AudioCtx();
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

  window.setTimeout(() => {
    void context.close().catch(() => {
      // Ignore close race errors.
    });
  }, 700);
}
