<?php

declare(strict_types=1);

namespace Tests\Unit\Support;

use App\Support\SqliteTextLobStatement;
use Illuminate\Support\Facades\DB;
use PDO;
use Tests\TestCase;

final class SqliteTextLobDeferTest extends TestCase
{
    public function test_connection_setup_does_not_open_a_missing_sqlite_file(): void
    {
        $path = sys_get_temp_dir().'/wgw-lob-defer-'.uniqid('', true).'.sqlite';

        config([
            'database.connections.wgw' => [
                'driver' => 'sqlite',
                'database' => $path,
                'prefix' => '',
                'foreign_key_constraints' => true,
            ],
        ]);
        DB::purge('wgw');

        $connection = DB::connection('wgw');

        $this->assertFileDoesNotExist($path);
        $this->assertInstanceOf(\Closure::class, $connection->getRawPdo());

        touch($path);
        $pdo = $connection->getPdo();
        $this->assertInstanceOf(PDO::class, $pdo);

        $statement = $pdo->prepare('select 1');
        $this->assertInstanceOf(SqliteTextLobStatement::class, $statement);

        @unlink($path);
    }
}
