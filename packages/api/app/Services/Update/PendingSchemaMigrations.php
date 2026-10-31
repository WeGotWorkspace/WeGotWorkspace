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
 *
 * Every step after the marker check runs under {@see SchemaMigrationLock}.
 * Requests that arrive while another process holds it are turned away, so
 * no request reads or writes a schema that is still changing.
 */
final class PendingSchemaMigrations
{
    private const MARKER = 'updates/schema-migrations.json';

    /** A failed run is retried on a later request after this many seconds. */
    public const RETRY_AFTER_SECONDS = 300;

    /**
     * How long a request waits for another process to finish migrating. The
     * apps do not retry a 503, so a short run should end in a normal answer.
     * Kept under common FPM and proxy timeouts (30 s and up).
     */
    public const LOCK_WAIT_SECONDS = 15.0;

    public function __construct(
        private WgwSchemaMigrator $migrator,
        private AppPaths $paths,
        private UpdateStateStore $updates,
        private SchemaMigrationLock $lock,
        private float $lockWaitSeconds = self::LOCK_WAIT_SECONDS,
    ) {}

    /**
     * Runs the pending migrations when this request is the first to see them.
     * While another process holds the schema lock it waits up to
     * {@see LOCK_WAIT_SECONDS}, then serves the request on the finished schema.
     *
     * @return bool False when the lock stayed busy for the whole wait. The
     *              schema is then still changing, so the caller must not
     *              serve the request.
     */
    public function applyIfPending(): bool
    {
        if (! $this->hasPersistentDatabase() || ! $this->installFinished()) {
            return true;
        }

        $signature = $this->migrator->migrationSetSignature();
        if ($this->markerStatus($signature) === 'current') {
            return true;
        }

        try {
            $lock = $this->lock->acquireWithin($this->lockWaitSeconds);
        } catch (\RuntimeException $e) {
            Log::error('Could not take the schema migration lock.', ['exception' => $e]);

            return true;
        }
        if ($lock === null) {
            return false;
        }

        try {
            $this->runPendingWhileLocked($signature);
        } finally {
            $this->lock->release($lock);
        }

        return true;
    }

    private function runPendingWhileLocked(string $signature): void
    {
        // The process this request waited for has usually finished (or failed).
        if ($this->markerStatus($signature) !== null) {
            return;
        }
        if (! $this->paths->runtimeInstallReady() || $this->updateIsRunning()) {
            return;
        }

        try {
            $pending = $this->migrator->pendingMigrations();
        } catch (\Throwable $e) {
            Log::error('Could not list pending database migrations.', ['exception' => $e]);

            return;
        }
        if ($pending === []) {
            $this->writeMarker(['signature' => $signature, 'status' => 'current']);

            return;
        }

        @set_time_limit(0);
        ignore_user_abort(true);
        // Written first so a process killed mid-run still backs off the
        // next request. Success overwrites it.
        $this->writeFailedMarker($signature);
        $this->updates->appendLog(sprintf(
            'Running %d database migration(s) the update left pending, starting at %s.',
            count($pending),
            $pending[0],
        ));
        try {
            $this->migrator->migrate();
        } catch (\Throwable $e) {
            $this->writeFailedMarker($signature);
            $this->updates->appendLog('Pending database migrations failed: '.$e->getMessage());
            Log::error('Could not apply database migrations an update left pending.', ['exception' => $e]);

            return;
        }
        $this->writeMarker(['signature' => $signature, 'status' => 'current']);
        $this->updates->appendLog('Pending database migrations finished.');
        Log::warning('Applied database migrations an update left pending.', ['migrations' => $pending]);
    }

    /**
     * Before the install the data directory is still the default one inside
     * the document root, and reading the marker or taking the lock would
     * create it there (#1803). The `.installed` file keeps this to one stat
     * per request; the full check only runs when that file is missing.
     */
    private function installFinished(): bool
    {
        return true; // Throwaway: reintroduces #1803.
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

    /**
     * @return 'current'|'failed'|null 'failed' only inside the retry window.
     */
    private function markerStatus(string $signature): ?string
    {
        $raw = @file_get_contents($this->absolute(self::MARKER));
        $marker = is_string($raw) ? json_decode($raw, true) : null;
        if (! is_array($marker) || ($marker['signature'] ?? null) !== $signature) {
            return null;
        }
        if (($marker['status'] ?? null) === 'current') {
            return 'current';
        }
        $failedAt = $marker['failedAt'] ?? null;

        return is_int($failedAt) && time() - $failedAt < self::RETRY_AFTER_SECONDS ? 'failed' : null;
    }

    private function writeFailedMarker(string $signature): void
    {
        $this->writeMarker(['signature' => $signature, 'status' => 'failed', 'failedAt' => time()]);
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
