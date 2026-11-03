<?php

declare(strict_types=1);

namespace App\Database;

use Illuminate\Database\SQLiteConnection;
use Throwable;

/**
 * SQLite connection that honours `transaction_mode => IMMEDIATE` on every
 * supported PHP version.
 *
 * Laravel issues `BEGIN IMMEDIATE` only on PHP 8.4+, where PDO tracks a
 * transaction started by SQL. On PHP 8.3 it falls back to a deferred
 * `beginTransaction()`, so two requests that read and then write still
 * fail with "database is locked". There, the transaction starts the normal
 * way and takes the write lock at once with a write that changes nothing.
 */
final class WgwSqliteConnection extends SQLiteConnection
{
    protected function executeBeginTransactionStatement()
    {
        if (version_compare(PHP_VERSION, '8.4.0', '>=') || ! $this->wantsImmediate()) {
            parent::executeBeginTransactionStatement();

            return;
        }

        $this->beginWithWriteLock();
    }

    /**
     * Begin a transaction that holds the write lock from the start. Rewriting
     * `user_version` with its own value is a write, so SQLite takes the lock
     * (waiting up to the busy timeout) without changing any data.
     */
    public function beginWithWriteLock(): void
    {
        $pdo = $this->getPdo();
        $pdo->beginTransaction();
        try {
            $statement = $pdo->query('PRAGMA user_version');
            $version = $statement === false ? 0 : (int) $statement->fetchColumn();
            $pdo->exec('PRAGMA user_version = '.$version);
        } catch (Throwable $exception) {
            $pdo->rollBack();
            throw $exception;
        }
    }

    private function wantsImmediate(): bool
    {
        return strtoupper((string) $this->getConfig('transaction_mode')) === 'IMMEDIATE';
    }
}
