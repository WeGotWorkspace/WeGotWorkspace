<?php

declare(strict_types=1);

namespace App\Database;

use Closure;
use Illuminate\Database\QueryException;
use Illuminate\Database\SQLiteConnection;
use PDOException;
use Throwable;

/**
 * SQLite connection that waits for the write lock instead of failing with
 * "database is locked" when several PHP workers write at once (#1536, #2157).
 *
 * - Every transaction takes the write lock at BEGIN (`transaction_mode =>
 *   IMMEDIATE`), on every supported PHP version. Laravel issues `BEGIN
 *   IMMEDIATE` only on PHP 8.4+, where PDO tracks a transaction started by
 *   SQL; on PHP 8.3 the transaction starts the normal way and takes the lock
 *   at once with a write that changes nothing.
 * - When SQLite still answers "busy", a step that has not changed anything
 *   yet (a BEGIN, or a statement outside a transaction) is tried again a
 *   couple of times before the error reaches the caller.
 */
final class WgwSqliteConnection extends SQLiteConnection
{
    /** Tries after the first one for a step SQLite answered with "busy". */
    private const LOCK_RETRIES = 2;

    /** Pause before each retry, in milliseconds (the busy timeout already waited). */
    private const LOCK_RETRY_PAUSE_MS = [50, 150];

    /** SQLITE_BUSY: another connection holds the lock this step needs. */
    private const SQLITE_BUSY = 5;

    protected function executeBeginTransactionStatement()
    {
        $this->retryWhileBusy(function (): void {
            if (version_compare(PHP_VERSION, '8.4.0', '>=') || ! $this->wantsImmediate()) {
                parent::executeBeginTransactionStatement();

                return;
            }

            $this->beginWithWriteLock();
        });
    }

    /**
     * Begin a transaction that holds the write lock from the start. Rewriting
     * `user_version` with its own value is a write, so SQLite takes the lock
     * (waiting up to the busy timeout) without changing any data.
     *
     * The value is read before the transaction starts. A read inside it would
     * take a read lock first, and SQLite never waits when it has to turn a
     * read lock into the write lock while another writer holds it: it fails
     * at once with "database is locked", busy timeout or not. That was the
     * cause of #2157 on PHP 8.3. Nothing else writes `user_version`, so the
     * value cannot change between the read and the write.
     */
    public function beginWithWriteLock(): void
    {
        $version = $this->userVersion();
        $pdo = $this->getPdo();
        $pdo->beginTransaction();
        try {
            $pdo->exec('PRAGMA user_version = '.$version);
        } catch (Throwable $exception) {
            $pdo->rollBack();
            throw $exception;
        }
    }

    /**
     * Outside a transaction a statement that hit "busy" changed nothing, so it
     * can run again. Inside one the whole transaction would have to restart,
     * which only the caller can do.
     *
     * @param  string  $query
     * @param  array<int|string, mixed>  $bindings
     */
    protected function handleQueryException(QueryException $e, $query, $bindings, Closure $callback)
    {
        if ($this->transactions === 0 && self::isBusy($e)) {
            return $this->retryWhileBusy(
                fn () => $this->runQueryCallback($query, $bindings, $callback),
                alreadyFailed: true,
            );
        }

        return parent::handleQueryException($e, $query, $bindings, $callback);
    }

    public static function isBusy(Throwable $e): bool
    {
        for ($current = $e; $current !== null; $current = $current->getPrevious()) {
            if ($current instanceof PDOException && (int) ($current->errorInfo[1] ?? 0) === self::SQLITE_BUSY) {
                return true;
            }
        }

        return str_contains($e->getMessage(), 'database is locked');
    }

    /**
     * @template T
     *
     * @param  Closure(): T  $step
     * @return T
     */
    private function retryWhileBusy(Closure $step, bool $alreadyFailed = false): mixed
    {
        $attempt = $alreadyFailed ? 1 : 0;
        while (true) {
            if ($attempt > 0) {
                usleep(self::LOCK_RETRY_PAUSE_MS[min($attempt, count(self::LOCK_RETRY_PAUSE_MS)) - 1] * 1000);
            }
            try {
                return $step();
            } catch (Throwable $exception) {
                if ($attempt >= self::LOCK_RETRIES || ! self::isBusy($exception)) {
                    throw $exception;
                }
                $attempt++;
            }
        }
    }

    private function userVersion(): int
    {
        $statement = $this->getPdo()->query('PRAGMA user_version');
        // fetchAll finishes the statement, so it holds no read lock afterwards.
        $rows = $statement === false ? [] : $statement->fetchAll(\PDO::FETCH_COLUMN);

        return (int) ($rows[0] ?? 0);
    }

    private function wantsImmediate(): bool
    {
        return strtoupper((string) $this->getConfig('transaction_mode')) === 'IMMEDIATE';
    }
}
