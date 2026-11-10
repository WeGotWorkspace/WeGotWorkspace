import { extensionFromFileName } from "@/drive-core/src/drive-file-utils";

/**
 * Hues for common extensions, grouped by family so a PDF always reads red and a
 * sheet green. Other extensions get a hue from their name (`extensionHue`).
 */
const EXTENSION_HUES: Readonly<Record<string, number>> = {
  pdf: 25,
  doc: 255,
  docx: 255,
  odt: 255,
  rtf: 240,
  pages: 235,
  xls: 150,
  xlsx: 150,
  ods: 150,
  csv: 165,
  numbers: 140,
  ppt: 50,
  pptx: 50,
  odp: 50,
  key: 60,
  md: 285,
  markdown: 285,
  txt: 215,
  zip: 80,
  rar: 85,
  "7z": 90,
  tar: 75,
  gz: 70,
  jpg: 340,
  jpeg: 340,
  png: 320,
  gif: 355,
  webp: 330,
  heic: 345,
  svg: 10,
  mp4: 300,
  mov: 305,
  webm: 295,
  mp3: 190,
  wav: 195,
  m4a: 185,
  flac: 200,
  json: 120,
  html: 35,
  css: 225,
  js: 100,
  ts: 245,
};

/** A stable hue for an extension: the curated family hue, else one from its name. */
export function extensionHue(extension: string): number {
  const key = extension.toLowerCase();
  const curated = EXTENSION_HUES[key];
  if (curated !== undefined) return curated;
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return (hash * 47) % 360;
}

/** The avatar's label: the extension, uppercase, at most four letters ("DOCX", "MD"). */
export function extensionAvatarLabel(fileName: string): string {
  return extensionFromFileName(fileName).slice(0, 4).toUpperCase();
}
