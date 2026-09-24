export function shouldShowOsNotification(visibilityState: string, permission: string): boolean {
  return visibilityState !== "visible" && permission === "granted";
}
