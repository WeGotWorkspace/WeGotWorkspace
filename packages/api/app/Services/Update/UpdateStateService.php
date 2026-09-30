<?php

declare(strict_types=1);

namespace App\Services\Update;

use App\Storage\WgwStorage;

final class UpdateStateService
{
    public function __construct(
        private UpdateStateStore $store,
        private UpdateRunner $runner,
    ) {}

    /**
     * @return array<string, mixed>
     */
    public function snapshot(): array
    {
        $this->runner->recoverStaleLockState();

        return $this->runner->getState();
    }

    /** @return array<mixed> */
    public function deleteBackup(string $name): array
    {
        $name = $this->ensureBackupName($name);
        $disk = $this->store->backupDir();
        $path = $disk.'/'.$name;
        $storage = app(WgwStorage::class)->data();
        if (! $storage->exists($path) && ! $storage->directoryExists($path)) {
            throw new \InvalidArgumentException('Backup not found.');
        }
        if ($storage->directoryExists($path)) {
            $storage->deleteDirectory($path);
        } else {
            $storage->delete($path);
        }

        return $this->snapshot();
    }

    public function backupAbsolutePath(string $name): string
    {
        $name = $this->ensureBackupName($name);
        $storage = app(WgwStorage::class)->data();
        $key = $this->store->backupDir().'/'.$name;
        if ($storage->directoryExists($key)) {
            throw new \InvalidArgumentException('Legacy backup folders are not directly downloadable. Use ZIP backups.');
        }
        if (! $storage->fileExists($key)) {
            throw new \InvalidArgumentException('Backup not found.');
        }

        return $storage->path($key);
    }

    private function ensureBackupName(string $name): string
    {
        $trimmed = trim($name);
        if ($trimmed === '' || preg_match('/^[A-Za-z0-9._-]+$/', $trimmed) !== 1) {
            throw new \InvalidArgumentException('Invalid backup file name.');
        }

        return $trimmed;
    }
}
