# Engineering tasks — data directory outside the web root

**Not** a copy of the GitHub issue `- [ ]` acceptance checklist.

Source spec: [spec.md](./spec.md)  
Source plan: [plan.md](./plan.md)

## Chunks

| id | owner / agent | skill | key paths | verify command |
|----|---------------|-------|-----------|----------------|
| `chunk-a-data-dir` | builder | api | `packages/api/app/Services/Installer/DataDirCandidateResolver.php`, `InstallerWizardService.php`, `WgwInstallEnv.php`, `AdminStateService.php`, `packages/apps/src/installer-core`, `docker/install`, `INSTALL.md` | `composer --working-dir packages/api exec phpunit -- tests/Unit/Installer/DataDirCandidateResolverTest.php tests/Feature/Installer/DataDirInstallTest.php` |
