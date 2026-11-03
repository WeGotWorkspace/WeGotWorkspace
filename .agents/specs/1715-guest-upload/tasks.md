# Engineering tasks — Guests upload into a shared folder

**Not** a copy of the GitHub issue `- [ ]` acceptance checklist. This file tracks which chunk implements which technical piece.

Source spec: [spec.md](./spec.md)

## Chunk A — API

| Task | Key paths | Verify |
|------|-----------|--------|
| `edit` allowed on public folder links, refused on file links | `app/Services/Drive/DriveShareRules.php`, `DriveShareService.php` | `DriveShareAccessMatrixTest` |
| Guest gate, account id, registry | `app/Services/Jmap/Guest/` | `JmapGuestUploadTest` |
| Account context consults the registry | `app/Services/Jmap/FileNodes/FileNodeAccountSupport.php` | `JmapGuestUploadTest` |
| Guest dispatcher and capability set | `app/Services/Jmap/Guest/`, `app/Providers/WgwServiceProvider.php` | `JmapGuestUploadTest` |
| Guest write rules | `app/Services/Jmap/Guest/GuestFileNodeSetMethod.php` | `JmapGuestUploadAclTest` |
| Guest `mayAddChildren` on `edit` | `app/Services/Jmap/FileNodes/FileNodeMapper.php` | `JmapGuestUploadAclTest` |
| Routes, controllers, limiter, byte budget | `routes/api.php`, `app/Http/Controllers/Api/V1/Jmap/`, `app/Http/RateLimiting/` | `JmapGuestUploadLimitsTest` |
| OpenAPI | `openapi/openapi.json` | `pnpm test:api-done-gate` |

## Chunk B — Client

| Task | Key paths | Verify |
|------|-----------|--------|
| Guest Drive operations with the queue | `packages/apps/src/lib/api/wgw/drive.ts`, `lib/offline/drive/` | vitest |
| Guest root resolution in the JMAP path cache | `packages/apps/src/lib/api/wgw/drive-jmap.ts` | vitest |
| Upload gate for guests | `packages/apps/src/drive-core/` | story `Features/Drive/UploadAccess` |
| Link level in the share dialog | `packages/apps/src/share-ui/share-link-section.tsx` | story |
| Browser e2e: edit link, small and chunked upload, revoke mid-upload, view link | own ports 9114 / 5214 | manual + script |
