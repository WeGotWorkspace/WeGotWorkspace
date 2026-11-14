<?php

declare(strict_types=1);

namespace App\Database;

use Illuminate\Database\Connectors\SQLiteConnector;
use Illuminate\Support\Facades\Log;
use PDO;
use Throwable;

/**
 * SQLite connector that sets the journal mode without failing the request.
 *
 * The wgw database runs in WAL mode (#2157): readers and one writer work at
 * the same time, so a team's polling no longer holds up every save. The mode
 * is stored in the database file. The first connection after an update
 * switches an existing database over; every later connection finds it set.
 *
 * Switching needs a moment with no other connection reading or writing. When
 * that does not come within the busy timeout, or the file system cannot hold
 * WAL's shared-memory file (some network shares), the connection keeps the
 * mode it has and logs a warning, and the next connection tries again.
 */
final class WgwSqliteConnector extends SQLiteConnector
{
    /** Journal modes a config value may name (it is interpolated into SQL). */
    private const JOURNAL_MODES = ['delete', 'truncate', 'persist', 'memory', 'wal', 'off'];

    /**
     * @param  PDO  $connection
     * @param  array<string, mixed>  $config
     */
    protected function configureJournalMode($connection, array $config): void
    {
        $wanted = strtolower(trim((string) ($config['journal_mode'] ?? '')));
        if ($wanted === '' || $this->isInMemory((string) ($config['database'] ?? ''))) {
            return;
        }
        if (! in_array($wanted, self::JOURNAL_MODES, true)) {
            Log::warning('Ignoring an unknown SQLite journal mode.', ['journal_mode' => $wanted]);

            return;
        }

        try {
            if ($this->currentJournalMode($connection) === $wanted) {
                return;
            }
            $statement = $connection->query('PRAGMA journal_mode = '.$wanted);
            $now = $statement === false ? '' : strtolower((string) ($statement->fetchAll(PDO::FETCH_COLUMN)[0] ?? ''));
        } catch (Throwable $exception) {
            $now = 'unchanged: '.$exception->getMessage();
        }

        if ($now !== $wanted) {
            Log::warning('Could not switch the SQLite journal mode; keeping the current one for now.', [
                'database' => basename((string) ($config['database'] ?? '')),
                'wanted' => $wanted,
                'result' => $now,
            ]);
        }
    }

    private function currentJournalMode(PDO $connection): string
    {
        $statement = $connection->query('PRAGMA journal_mode');

        return $statement === false ? '' : strtolower((string) ($statement->fetchAll(PDO::FETCH_COLUMN)[0] ?? ''));
    }

    private function isInMemory(string $database): bool
    {
        return $database === ':memory:' || str_contains($database, 'mode=memory');
    }
}
