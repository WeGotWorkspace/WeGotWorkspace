export function backupDownloadUrl(name: string): string {
  return `/api/v1/admin/updates/backups/${encodeURIComponent(name)}`;
}
