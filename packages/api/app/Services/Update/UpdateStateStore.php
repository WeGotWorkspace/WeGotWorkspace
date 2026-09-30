<?php

declare(strict_types=1);

namespace App\Services\Update;

use App\Storage\WgwStorage;
use Illuminate\Contracts\Filesystem\Filesystem;

final class UpdateStateStore
{
    private const BASE = 'updates';

    public function __construct(private WgwStorage $storage) {}

    /**
     * @return array<string, mixed>
     */
    public function read(): array
    {
        $disk = $this->disk();
        if (! $disk->exists(self::BASE.'/state.json')) {
            return [];
        }
        $raw = $disk->get(self::BASE.'/state.json');
        $decoded = is_string($raw) ? json_decode($raw, true) : null;

        return is_array($decoded) ? $decoded : [];
    }

    /**
     * @param  array<string, mixed>  $state
     */
    public function write(array $state): void
    {
        $this->disk()->put(
            self::BASE.'/state.json',
            json_encode($state, JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT)."\n"
        );
    }

    /**
     * @return list<string>
     */
    public function readLog(): array
    {
        $path = self::BASE.'/process.log';
        $disk = $this->disk();
        if (! $disk->exists($path)) {
            return [];
        }

        $raw = $disk->get($path);
        $lines = is_string($raw) ? (preg_split("/\r\n|\n|\r/", $raw) ?: []) : [];

        return array_slice(array_filter($lines, static fn (string $line): bool => trim($line) !== ''), -300);
    }

    public function clearLog(): void
    {
        $this->disk()->put(self::BASE.'/process.log', '');
    }

    public function lockPath(): string
    {
        return self::BASE.'/update.lock';
    }

    public function maintenancePath(): string
    {
        return self::BASE.'/.maintenance';
    }

    public function backupDir(): string
    {
        return self::BASE.'/backup';
    }

    public function isLocked(): bool
    {
        return $this->disk()->exists($this->lockPath());
    }

    public function isMaintenance(): bool
    {
        return $this->disk()->exists($this->maintenancePath());
    }

    public function cancelKey(): string
    {
        return self::BASE.'/cancel.requested';
    }

    public function packageKey(): string
    {
        return self::BASE.'/tmp/release.zip';
    }

    public function stagingKey(): string
    {
        return self::BASE.'/tmp/staging';
    }

    public function tmpKey(): string
    {
        return self::BASE.'/tmp';
    }

    public function absolutePath(string $key): string
    {
        return $this->disk()->path($key);
    }

    public function appendLog(string $message): void
    {
        $path = self::BASE.'/process.log';
        $disk = $this->disk();
        $existing = $disk->exists($path) ? $disk->get($path) : '';
        $disk->put($path, $existing.'['.date('c').'] '.$message."\n");
    }

    public function requestCancel(): void
    {
        $this->disk()->put($this->cancelKey(), date('c')."\n");
    }

    public function clearCancelRequest(): void
    {
        $key = $this->cancelKey();
        if ($this->disk()->exists($key)) {
            $this->disk()->delete($key);
        }
    }

    public function isCancelRequested(): bool
    {
        return $this->disk()->exists($this->cancelKey());
    }

    public function cleanupTemporaryData(): void
    {
        $disk = $this->disk();
        if ($disk->directoryExists($this->tmpKey())) {
            $disk->deleteDirectory($this->tmpKey());
        }
        if ($disk->exists($this->packageKey())) {
            $disk->delete($this->packageKey());
        }
        $this->clearCancelRequest();
    }

    public function ensureDirs(): void
    {
        $disk = $this->disk();
        foreach ([self::BASE, $this->tmpKey(), $this->backupDir()] as $dir) {
            if (! $disk->directoryExists($dir)) {
                $disk->makeDirectory($dir);
            }
        }
    }

    private function disk(): Filesystem
    {
        return $this->storage->data();
    }
}
