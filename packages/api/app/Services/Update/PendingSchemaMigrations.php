<?php

declare(strict_types=1);

namespace App\Services\Update;

use App\Services\Installer\WgwSchemaMigrator;
use App\Support\AppPaths;
use Illuminate\Support\Facades\Log;

/**
 * Runs wgw migrations that an update left pending (#1076).
 *
 * The in-app updater swaps the files and then runs the new migrations in the
 * same PHP process. That process still has the old release's Composer
 * autoloader and classes in memory. Once a new migration needs a class from a
 * package the old release did not ship, it fails (0.1.70 → 0.1.115 stops on
 * the first new migration with `Trait "Laravel\Passport\HasApiTokens" not
 * found`). VERSION is already bumped, so the install reports the new release
 * on a schema that lacks every new table.
 *
 * The first request served by the new code finishes the job in a clean
 * process. A marker in the data directory keeps later requests to a file
 * read and a directory listing.
 */
final class PendingSchemaMigrations
{
    private const MARKER = 'updates/schema-migrations.json';

    private const LOCK = 'updates/schema-migrations.lock';

    /** A failed run is retried on a later request after this many seconds. */
    public const RETRY_AFTER_SECONDS = 300;

    public function __construct(
        private WgwSchemaMigrator $migrator,
        private AppPaths $paths,
        private UpdateStateStore $updates,
    ) {}

    /**
     * @return bool False while another request holds the schema lock and is
     *              migrating: the caller must not run a route against a
     *              half-migrated schema.
     */
    public function applyIfPending(): bool
    {
        if (! $this->hasPersistentDatabase()) {
            return true;
        }

        $signature = $this->migrator->migrationSetSignature();
        if ($this->markerSkipsRun($signature)) {
            return true;
        }

        $lock = $this->acquireLock();
        if ($lock === false) {
            return false;
        }

        try {
            // Another request may have finished while this one took the lock.
            if ($this->markerSkipsRun($signature)
                || ! $this->paths->runtimeInstallReady()
                || $this->updateIsRunning()) {
                return true;
            }
            $this->runPending($signature);
        } finally {
            if (is_resource($lock)) {
                flock($lock, LOCK_UN);
                fclose($lock);
            }
        }

        return true;
    }

    private function runPending(string $signature): void
    {
        try {
            $pending = $this->migrator->pendingMigrations();
            if ($pending === []) {
                $this->writeMarker(['signature' => $signature, 'status' => 'current']);

                return;
            }

            @set_time_limit(0);
            ignore_user_abort(true);
            $this->updates->appendLog(sprintf(
                'Running %d database migration(s) the update left pending, starting at %s.',
                count($pending),
                $pending[0],
            ));
            $this->migrator->migrate();
            $this->writeMarker(['signature' => $signature, 'status' => 'current']);
            $this->updates->appendLog('Pending database migrations finished.');
            Log::warning('Applied database migrations an update left pending.', ['migrations' => $pending]);
        } catch (\Throwable $e) {
            $this->writeMarker([
                'signature' => $signature,
                'status' => 'failed',
                'failedAt' => time(),
            ]);
            $this->updates->appendLog('Pending database migrations failed: '.$e->getMessage());
            Log::error('Could not apply database migrations an update left pending.', ['exception' => $e]);
        }
    }

    private function hasPersistentDatabase(): bool
    {
        $connection = config('database.connections.wgw');
        if (! is_array($connection)) {
            return false;
        }
        $database = (string) ($connection['database'] ?? '');

        return ($connection['driver'] ?? '') !== '' && $database !== '' && $database !== ':memory:';
    }

    private function markerSkipsRun(string $signature): bool
    {
        $raw = @file_get_contents($this->absolute(self::MARKER));
        $marker = is_string($raw) ? json_decode($raw, true) : null;
        if (! is_array($marker) || ($marker['signature'] ?? null) !== $signature) {
            return false;
        }
        if (($marker['status'] ?? null) === 'current') {
            return true;
        }
        $failedAt = $marker['failedAt'] ?? null;

        return is_int($failedAt) && time() - $failedAt < self::RETRY_AFTER_SECONDS;
    }

    /**
     * True while an updater process holds its lock. A lock file nobody holds
     * is left over from a killed process and does not count.
     */
    private function updateIsRunning(): bool
    {
        $path = $this->updates->absolutePath($this->updates->lockPath());
        if (! is_file($path)) {
            return false;
        }
        $handle = @fopen($path, 'r');
        if (! is_resource($handle)) {
            return true;
        }
        $free = flock($handle, LOCK_EX | LOCK_NB);
        if ($free) {
            flock($handle, LOCK_UN);
        }
        fclose($handle);

        return ! $free;
    }

    /**
     * @return resource|true|false True when the lock cannot be used at all
     *                              (no writable data dir); false when held elsewhere.
     */
    private function acquireLock()
    {
        $path = $this->absolute(self::LOCK);
        if (! $this->ensureParentDir($path)) {
            return true;
        }
        $handle = @fopen($path, 'c');
        if (! is_resource($handle)) {
            return true;
        }
        if (! flock($handle, LOCK_EX | LOCK_NB)) {
            fclose($handle);

            return false;
        }

        return $handle;
    }

    /**
     * @param  array<string, int|string>  $marker
     */
    private function writeMarker(array $marker): void
    {
        $path = $this->absolute(self::MARKER);
        if ($this->ensureParentDir($path)) {
            @file_put_contents($path, json_encode($marker, JSON_UNESCAPED_SLASHES)."\n", LOCK_EX);
        }
    }

    private function ensureParentDir(string $path): bool
    {
        $dir = dirname($path);

        return is_dir($dir) || @mkdir($dir, 0775, true) || is_dir($dir);
    }

    private function absolute(string $key): string
    {
        return $this->updates->absolutePath($key);
    }
}
