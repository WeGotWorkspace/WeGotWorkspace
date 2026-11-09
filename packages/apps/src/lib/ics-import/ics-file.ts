/** File-picker `accept` for ICS imports (Calendar and Tasks). */
export const ICS_FILE_ACCEPT = ".ics,text/calendar";

export function isIcsFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return name.endsWith(".ics") || name.endsWith(".ical") || file.type === "text/calendar";
}

/** Default collection name from an ICS filename. Empty when nothing sensible remains. */
export function inferCollectionNameFromIcsFileName(fileName: string): string {
  const leaf = fileName.trim().split(/[/\\]/).pop() ?? "";
  return leaf.replace(/\.(ics|ical)$/i, "").trim();
}

export function filterIcsFiles(fileList: FileList | null): File[] {
  if (!fileList || fileList.length === 0) return [];
  return Array.from(fileList).filter(isIcsFile);
}

export function icsFileFromList(fileList: FileList | null): File | null {
  return filterIcsFiles(fileList)[0] ?? null;
}

export async function readIcsFile(file: File): Promise<string> {
  return file.text();
}
