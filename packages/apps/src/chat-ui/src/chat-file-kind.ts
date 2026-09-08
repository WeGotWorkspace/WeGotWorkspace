import type { FileKind } from "@/drive-core/src/drive-models";

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "avif"]);
const VIDEO_EXT = new Set(["mp4", "webm", "mov", "m4v"]);
const AUDIO_EXT = new Set(["mp3", "wav", "aac", "ogg", "m4a"]);
const ARCHIVE_EXT = new Set(["zip", "tar", "gz", "tgz", "rar", "7z"]);
const DOC_EXT = new Set(["md", "markdown", "txt", "doc", "docx", "rtf", "html"]);

export function chatFileKindFromName(fileName: string | undefined): FileKind {
  const ext = fileName?.split(".").pop()?.toLowerCase();
  if (!ext || ext === fileName?.toLowerCase()) return "file";
  if (IMAGE_EXT.has(ext)) return "image";
  if (VIDEO_EXT.has(ext)) return "video";
  if (AUDIO_EXT.has(ext)) return "audio";
  if (ARCHIVE_EXT.has(ext)) return "archive";
  if (DOC_EXT.has(ext)) return "doc";
  return "file";
}
