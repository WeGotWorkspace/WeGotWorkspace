<?php

declare(strict_types=1);

namespace Tests\Unit\Support;

use App\Support\SqliteTextLobStatement;
use PDO;
use PHPUnit\Framework\TestCase;

final class SqliteTextLobStatementTest extends TestCase
{
    public function test_string_lob_binds_stay_text_so_like_matches(): void
    {
        $pdo = $this->sqlite();
        SqliteTextLobStatement::enableOn($pdo);

        $payload = 'BEGIN:VCALENDAR UID:ams-persist-1 END:VCALENDAR';
        $stmt = $pdo->prepare('INSERT INTO t (calendardata) VALUES (:calendardata)');
        $stmt->bindParam('calendardata', $payload, PDO::PARAM_LOB);
        $stmt->execute();

        $row = $pdo->query('SELECT typeof(calendardata) AS typ FROM t')->fetch(PDO::FETCH_ASSOC);
        $this->assertIsArray($row);
        $this->assertSame('text', $row['typ']);
        $matched = $pdo->query("SELECT COUNT(*) FROM t WHERE calendardata LIKE '%ams-persist-1%'")->fetchColumn();
        $this->assertSame(1, (int) $matched);
    }

    public function test_stream_lob_binds_stay_blobs(): void
    {
        $pdo = $this->sqlite();
        SqliteTextLobStatement::enableOn($pdo);

        $stream = fopen('php://memory', 'r+');
        $this->assertIsResource($stream);
        fwrite($stream, 'BEGIN:VCALENDAR UID:stream-only END:VCALENDAR');
        rewind($stream);

        $stmt = $pdo->prepare('INSERT INTO t (calendardata) VALUES (:calendardata)');
        $stmt->bindParam('calendardata', $stream, PDO::PARAM_LOB);
        $stmt->execute();
        if (is_resource($stream)) {
            fclose($stream);
        }

        $row = $pdo->query('SELECT typeof(calendardata) AS typ FROM t')->fetch(PDO::FETCH_ASSOC);
        $this->assertIsArray($row);
        $this->assertSame('blob', $row['typ']);
    }

    private function sqlite(): PDO
    {
        $pdo = new PDO('sqlite::memory:');
        $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $pdo->exec('CREATE TABLE t (id INTEGER PRIMARY KEY, calendardata BLOB)');

        return $pdo;
    }
}
