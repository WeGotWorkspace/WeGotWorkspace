<?php

declare(strict_types=1);

namespace App\Services\Search;

use App\Storage\WgwStorage;
use Illuminate\Contracts\Filesystem\Filesystem;

final class SearchReindexStateStore
{
    private const BASE = 'search-index';

    public function __construct(private WgwStorage $storage) {}

    /**
     * @return array<string, mixed>
     */
    public function read(): array
    {
        $disk = $this->disk();
        $path = self::BASE.'/state.json';
        if (! $disk->exists($path)) {
            return [];
        }

        $raw = $disk->get($path);
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

    public function appendLog(string $line): void
    {
        $disk = $this->disk();
        $path = self::BASE.'/process.log';
        $existing = $disk->exists($path) ? $disk->get($path) : '';
        $disk->put($path, $existing.'['.date('c').'] '.$line."\n");
    }

    /**
     * @return list<string>
     */
    public function readLog(): array
    {
        $disk = $this->disk();
        $path = self::BASE.'/process.log';
        if (! $disk->exists($path)) {
            return [];
        }
        $raw = $disk->get($path);
        $lines = is_string($raw) ? (preg_split("/\r\n|\n|\r/", $raw) ?: []) : [];

        return array_slice(array_filter($lines, static fn (string $line): bool => trim($line) !== ''), -400);
    }

    public function clearCancelRequest(): void
    {
        $key = $this->cancelPath();
        if ($this->disk()->exists($key)) {
            $this->disk()->delete($key);
        }
    }

    public function requestCancel(): void
    {
        $this->disk()->put($this->cancelPath(), date('c')."\n");
    }

    public function isCancelRequested(): bool
    {
        return $this->disk()->exists($this->cancelPath());
    }

    public function lockPath(): string
    {
        return self::BASE.'/reindex.lock';
    }

    public function cancelPath(): string
    {
        return self::BASE.'/cancel.requested';
    }

    public function absolutePath(string $key): string
    {
        return $this->disk()->path($key);
    }

    public function ensureDirs(): void
    {
        $disk = $this->disk();
        if (! $disk->directoryExists(self::BASE)) {
            $disk->makeDirectory(self::BASE);
        }
    }

    private function disk(): Filesystem
    {
        return $this->storage->data();
    }
}
