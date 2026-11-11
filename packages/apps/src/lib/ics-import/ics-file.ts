/** File-picker `accept` for ICS imports (Calendar and Tasks). */
export const ICS_FILE_ACCEPT = ".ics,text/calendar";

/** Where an ICS import goes: an existing calendar or task list, or a new one. */
export type IcsImportDestination =
  { mode: "existing"; collectionId: string } | { mode: "create"; name: string; color: string };

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

/** True when the ICS text has at least one component of this type (e.g. `VTODO`). */
export function icsHasComponent(icsText: string, componentName: "VEVENT" | "VTODO"): boolean {
  return new RegExp(`^BEGIN:${componentName}\\s*$`, "im").test(icsText);
}

export async function readIcsFile(file: File): Promise<string> {
  return file.text();
}
