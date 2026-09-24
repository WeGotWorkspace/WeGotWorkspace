import type { ChatLinkPreview, MeetUnfurlMap } from "@/meet-core/src/meet-types";

export const CHAT_URL_SPLIT_PATTERN = /((?:https?:\/\/|www\.)[^\s]+)/gi;

export function normalizeChatUrl(raw: string): string {
  const trimmed = raw.replace(/[),.;!?]+$/u, "");
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export function extractChatUrls(text: string): string[] {
  const matches = text.match(CHAT_URL_SPLIT_PATTERN) ?? [];
  return [...new Set(matches.map(normalizeChatUrl))];
}

export function mapChatPreviews(text: string, unfurl: MeetUnfurlMap): ChatLinkPreview[] {
  return extractChatUrls(text).flatMap((url) => {
    const preview = unfurl[url];
    return preview ? [preview] : [];
  });
}
