<?php

declare(strict_types=1);

namespace App\Services\Calendars\Availability;

use Illuminate\Cache\FileStore;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use SplFileObject;

/**
 * Laravel's file store deletes an expired entry only when that same key is
 * read again, and a week entry under an old fingerprint never is. This sweep
 * deletes every expired file in the `availability` store and keeps live ones.
 */
final class AvailabilityCachePruner
{
    /**
     * @return array{deleted: int, kept: int}
     */
    public function prune(): array
    {
        $store = Cache::store(AvailabilityWeekCache::STORE)->getStore();
        if (! $store instanceof FileStore) {
            return ['deleted' => 0, 'kept' => 0];
        }

        $files = $store->getFilesystem();
        $directory = $store->getDirectory();
        if (! $files->isDirectory($directory)) {
            return ['deleted' => 0, 'kept' => 0];
        }

        $now = Carbon::now()->getTimestamp();
        $deleted = 0;
        $kept = 0;
        foreach ($files->allFiles($directory) as $file) {
            $path = $file->getPathname();
            if ($this->expiresAt($path) <= $now) {
                $files->delete($path);
                $deleted++;
            } else {
                $kept++;
            }
        }

        return ['deleted' => $deleted, 'kept' => $kept];
    }

    /** The file store writes the expiry as the first ten bytes (Unix seconds). */
    private function expiresAt(string $path): int
    {
        try {
            $head = (new SplFileObject($path, 'r'))->fread(10);
        } catch (\RuntimeException) {
            return 0;
        }

        return is_string($head) && ctype_digit($head) ? (int) $head : 0;
    }
}
