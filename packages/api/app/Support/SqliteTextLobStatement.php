<?php

declare(strict_types=1);

namespace App\Support;

use PDO;
use PDOStatement;

/**
 * sabre/dav 4.7.1 binds calendar and card payloads with PDO::PARAM_LOB so
 * PostgreSQL BYTEA columns round-trip. SQLite stores a string bound as LOB
 * as BLOB, and LIKE does not match BLOB values, so alarm scans, meet-link
 * lookup, and group-member repair miss rows that are present.
 *
 * String payloads stay TEXT on SQLite. Stream LOBs are left unchanged.
 */
final class SqliteTextLobStatement extends PDOStatement
{
    public static function enableOn(PDO $pdo): void
    {
        if ($pdo->getAttribute(PDO::ATTR_DRIVER_NAME) !== 'sqlite') {
            return;
        }

        $pdo->setAttribute(PDO::ATTR_STATEMENT_CLASS, [self::class]);
    }

    public function bindParam(
        int|string $param,
        mixed &$var,
        int $type = PDO::PARAM_STR,
        int $maxLength = 0,
        mixed $driverOptions = null,
    ): bool {
        if ($type === PDO::PARAM_LOB && ! is_resource($var)) {
            $type = PDO::PARAM_STR;
        }

        return parent::bindParam($param, $var, $type, $maxLength, $driverOptions);
    }

    public function bindValue(int|string $param, mixed $value, int $type = PDO::PARAM_STR): bool
    {
        if ($type === PDO::PARAM_LOB && ! is_resource($value)) {
            $type = PDO::PARAM_STR;
        }

        return parent::bindValue($param, $value, $type);
    }
}
