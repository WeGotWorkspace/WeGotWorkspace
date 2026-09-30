<?php

declare(strict_types=1);

namespace Tests\Support\Update;

use App\Models\AppUpdateHistory;
use App\Services\Update\UpdateOperationsService;
use App\Services\Update\UpdateStateStore;
use App\Storage\StoragePaths;
use App\Storage\WgwStorage;
use App\Support\AppVersion;
use Illuminate\Support\Facades\DB;
use Tests\Support\WgwInstallFixture;
use Tests\Support\WgwTestDisks;

trait PreparesUpdateSandbox
{
    protected const FEED_URL = 'https://updates.test/manifest.json';

    protected const PACKAGE_URL = 'https://updates.test/pkg.zip';

    protected string $scratch = '';

    protected string $installRoot = '';

    protected string $dataRoot = '';

    protected ?UpdateReleaseFixture $releaseFixture = null;

    protected function bootUpdateSandbox(): void
    {
        $this->scratch = sys_get_temp_dir().'/wgw-update-'.uniqid('', true);
        $this->installRoot = $this->scratch.'/install';
        $this->dataRoot = $this->scratch.'/data';
        if (! mkdir($this->installRoot, 0775, true) || ! mkdir($this->dataRoot, 0775, true)) {
            throw new \RuntimeException('Could not create update sandbox.');
        }
        if (! str_starts_with($this->installRoot, rtrim(sys_get_temp_dir(), '/'))) {
            throw new \RuntimeException('Refusing to point the updater at a non-temp install root.');
        }

        $this->writeTree($this->installRoot, $this->installedTree());
        $this->releaseFixture = UpdateReleaseFixture::generate($this->scratch.'/keys');
        FakeHttps::install();

        WgwInstallFixture::bindInstallRoot($this->installRoot, $this->dataRoot);
        WgwTestDisks::refresh($this->dataRoot);
        config([
            'wgw.install_channel' => 'zip',
            'wgw.update_feed_url' => self::FEED_URL,
            'wgw.update_public_key_path' => $this->releaseFixture->publicKeyPath,
        ]);
        foreach ([
            WgwStorage::class,
            StoragePaths::class,
            UpdateStateStore::class,
            UpdateOperationsService::class,
            AppVersion::class,
        ] as $abstract) {
            $this->app->forgetInstance($abstract);
        }
        app(UpdateStateStore::class)->ensureDirs();
    }

    protected function destroyUpdateSandbox(): void
    {
        $this->unlockInstallRoot();
        FakeHttps::remove();
        if ($this->scratch !== '' && is_dir($this->scratch)) {
            TempTree::remove($this->scratch);
        }
        $this->scratch = '';
    }

    protected function operations(): UpdateOperationsService
    {
        return $this->app->make(UpdateOperationsService::class);
    }

    /**
     * @param  array<string, string>  $files
     */
    protected function writeTree(string $root, array $files): void
    {
        foreach ($files as $relative => $contents) {
            $path = $root.'/'.$relative;
            $dir = dirname($path);
            if (! is_dir($dir) && ! mkdir($dir, 0775, true) && ! is_dir($dir)) {
                throw new \RuntimeException('Could not create '.$dir);
            }
            if (file_put_contents($path, $contents) === false) {
                throw new \RuntimeException('Could not write '.$path);
            }
        }
    }

    /**
     * @return array<string, string>
     */
    protected function installedTree(): array
    {
        return [
            'VERSION' => "0.1.0\n",
            'index.php' => "<?php echo 'old-index';\n",
            'bootstrap/app.php' => "<?php\n",
            'wgw-config.sample.php' => "<?php\n",
            'packages/api/artisan' => "#!/usr/bin/env php\n",
            'packages/api/.env' => "APP_KEY=base64:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=\nWGW_DB_CONNECTION=sqlite\nWGW_DB_DATABASE=:memory:\nLOCAL_MARKER=keep-me\n",
            'packages/api/storage/logs/laravel.log' => "log-before\n",
            'packages/apps/marker.txt' => "apps-old\n",
        ];
    }

    /**
     * @return array<string, string>
     */
    protected function releaseTree(): array
    {
        return [
            'VERSION' => "0.2.0\n",
            'index.php' => "<?php echo 'new-index';\n",
            'bootstrap/app.php' => "<?php echo 'new-bootstrap';\n",
            'wgw-config.sample.php' => "<?php echo 'sample';\n",
            'packages/api/artisan' => "#!/usr/bin/env php\n",
            'packages/api/public/index.php' => "<?php\n",
            'packages/apps/marker.txt' => "apps-new\n",
        ];
    }

    protected function publishRelease(string $version, string $zipBytes, ?string $checksum = null, ?string $signature = null): void
    {
        if (! $this->releaseFixture instanceof UpdateReleaseFixture) {
            throw new \RuntimeException('Update sandbox is not booted.');
        }
        $checksum ??= hash('sha256', $zipBytes);
        $signature ??= $this->releaseFixture->sign($checksum);
        FakeHttps::$bodies[self::PACKAGE_URL] = $zipBytes;
        FakeHttps::$bodies[self::FEED_URL] = (string) json_encode([
            'version' => $version,
            'package_url' => self::PACKAGE_URL,
            'checksum_sha256' => $checksum,
            'checksum_signature' => $signature,
            'notes_url' => 'https://updates.test/notes',
        ], JSON_UNESCAPED_SLASHES);
        config(['wgw.update_feed_url' => self::FEED_URL]);
    }

    protected function plantBackup(string $name = 'backup-20200101120000-from-0.0.1-to-0.0.2.zip'): string
    {
        $dir = $this->dataRoot.'/updates/backup';
        if (! is_dir($dir) && ! mkdir($dir, 0775, true) && ! is_dir($dir)) {
            throw new \RuntimeException('Could not create backup directory.');
        }
        $path = $dir.'/'.$name;
        $zip = new \ZipArchive;
        if ($zip->open($path, \ZipArchive::CREATE | \ZipArchive::OVERWRITE) !== true) {
            throw new \RuntimeException('Could not plant backup archive.');
        }
        $zip->addFromString('.backup-meta.json', "{\"from_version\":\"0.0.1\",\"to_version\":\"0.0.2\"}\n");
        $zip->addFromString('database.sqlite', 'planted');
        $zip->close();

        return $path;
    }

    protected function lockInstallRoot(): void
    {
        if (! chmod($this->installRoot, 0555)) {
            $this->fail('Could not make the install root read-only.');
        }
    }

    protected function unlockInstallRoot(): void
    {
        if ($this->installRoot !== '' && is_dir($this->installRoot)) {
            chmod($this->installRoot, 0775);
        }
    }

    /**
     * File-backed SQLite so backupDatabase can copy a database. MySQL already can.
     *
     * @param  callable(\PDO): void  $callback
     */
    protected function withBackupDatabase(callable $callback): void
    {
        $connection = DB::connection('wgw');
        $driver = $connection->getDriverName();
        $database = (string) config('database.connections.wgw.database');
        if ($driver !== 'sqlite' || $database !== ':memory:') {
            $callback($connection->getPdo());

            return;
        }

        $original = $connection->getPdo();
        $originalRead = $connection->getRawReadPdo();
        $transactions = (new \ReflectionProperty($connection, 'transactions'))->getValue($connection);
        $path = $this->scratch.'/backup-source.sqlite';
        $filePdo = new \PDO('sqlite:'.$path, null, null, [
            \PDO::ATTR_ERRMODE => \PDO::ERRMODE_EXCEPTION,
        ]);
        $this->seedSqliteBackupDatabase($filePdo);
        $connection->setPdo($filePdo);
        $connection->setReadPdo($filePdo);
        try {
            $callback($filePdo);
        } finally {
            $connection->setPdo($original);
            $connection->setReadPdo($originalRead);
            (new \ReflectionProperty($connection, 'transactions'))->setValue($connection, $transactions);
        }
    }

    protected function seedCanary(): void
    {
        AppUpdateHistory::query()->create([
            'from_version' => '0.1.0',
            'to_version' => '0.1.0',
            'status' => 'seed',
            'message' => 'wgw-canary-before-apply',
            'created_at' => date('c'),
        ]);
    }

    protected function assertHistory(\PDO $pdo, string $status, string $messagePart): void
    {
        $statement = $pdo->query('SELECT status, message FROM app_update_history ORDER BY id');
        $this->assertInstanceOf(\PDOStatement::class, $statement);
        $rows = $statement->fetchAll(\PDO::FETCH_ASSOC);
        $this->assertIsArray($rows);
        foreach ($rows as $row) {
            if (! is_array($row)) {
                continue;
            }
            if (($row['status'] ?? null) === $status && str_contains((string) ($row['message'] ?? ''), $messagePart)) {
                return;
            }
        }
        $this->fail('Missing history row '.$status.' containing '.$messagePart.'.');
    }

    protected function assertUpdaterIdle(): void
    {
        $state = app(UpdateStateStore::class)->read();
        $this->assertArrayNotHasKey('phase', $state);
        $this->assertArrayNotHasKey('current', $state);
        $this->assertFileDoesNotExist($this->dataRoot.'/updates/update.lock');
        $this->assertFileDoesNotExist($this->dataRoot.'/updates/.maintenance');
        $this->assertFileDoesNotExist($this->dataRoot.'/updates/tmp/release.zip');
        $this->assertFileDoesNotExist($this->dataRoot.'/updates/tmp/release.zip.part');
    }

    protected function logText(): string
    {
        return implode("\n", app(UpdateStateStore::class)->readLog());
    }

    /**
     * @return list<string>
     */
    protected function backupZips(): array
    {
        $paths = glob($this->dataRoot.'/updates/backup/*.zip');
        $this->assertIsArray($paths);
        sort($paths);

        return array_values($paths);
    }

    protected function zipText(string $zipPath, string $name): string
    {
        $zip = new \ZipArchive;
        $this->assertTrue($zip->open($zipPath) === true);
        $raw = $zip->getFromName($name);
        $zip->close();
        $this->assertIsString($raw);

        return $raw;
    }

    protected function assertBackupTakenBeforeFileSwap(string $zipPath, \PDO $live): void
    {
        $this->assertStringContainsString('LOCAL_MARKER=keep-me', $this->zipText($zipPath, 'packages-api.env'));
        $meta = json_decode($this->zipText($zipPath, '.backup-meta.json'), true);
        $this->assertIsArray($meta);
        $this->assertSame('0.1.0', $meta['from_version']);
        $this->assertSame('0.2.0', $meta['to_version']);

        if ($live->getAttribute(\PDO::ATTR_DRIVER_NAME) === 'sqlite') {
            $copy = $this->scratch.'/assert-backup.sqlite';
            file_put_contents($copy, $this->zipText($zipPath, 'database.sqlite'));
            $snap = new \PDO('sqlite:'.$copy);
            $statement = $snap->query('SELECT message FROM app_update_history');
            $this->assertInstanceOf(\PDOStatement::class, $statement);
            $messages = $statement->fetchAll(\PDO::FETCH_COLUMN);
            $this->assertContains('wgw-canary-before-apply', $messages);
            $this->assertNotContains('Update applied successfully.', $messages);

            return;
        }

        $sql = $this->zipText($zipPath, 'database.sql');
        $this->assertStringContainsString('wgw-canary-before-apply', $sql);
        $this->assertStringNotContainsString('Update applied successfully.', $sql);
    }

    private function seedSqliteBackupDatabase(\PDO $pdo): void
    {
        $pdo->exec('CREATE TABLE migrations (
            id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
            migration VARCHAR NOT NULL,
            batch INTEGER NOT NULL
        )');
        $insert = $pdo->prepare('INSERT INTO migrations (migration, batch) VALUES (:migration, 1)');
        $files = glob(database_path('migrations/wgw/*.php')) ?: [];
        foreach ($files as $file) {
            $insert->execute(['migration' => basename($file, '.php')]);
        }
        $pdo->exec('CREATE TABLE app_update_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
            from_version VARCHAR NOT NULL,
            to_version VARCHAR NOT NULL,
            status VARCHAR NOT NULL,
            message TEXT NOT NULL,
            created_at VARCHAR NOT NULL
        )');
    }
}
