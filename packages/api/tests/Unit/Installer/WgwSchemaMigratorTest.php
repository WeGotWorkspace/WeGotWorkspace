<?php

declare(strict_types=1);

namespace Tests\Unit\Installer;

use App\Services\Installer\WgwSchemaMigrator;
use App\Support\WgwConnectionConfigurator;
use Illuminate\Support\Facades\Schema;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Support\WgwTestDatabase;
use Tests\TestCase;

final class WgwSchemaMigratorTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        WgwTestDatabase::configureConnection('sqlite');
    }

    public function test_migrate_empty_database_reaches_current_version(): void
    {
        $migrator = app(WgwSchemaMigrator::class);
        $migrator->migrate();

        $this->assertSame(WgwSchemaMigrator::CURRENT_SCHEMA_VERSION, $migrator->currentVersion());
        $this->assertExpectedSchemaAtCurrentVersion();
    }

    public function test_migrate_is_idempotent_when_already_at_current_version(): void
    {
        $migrator = app(WgwSchemaMigrator::class);
        $migrator->migrate();
        $migrator->migrate();

        $this->assertSame(WgwSchemaMigrator::CURRENT_SCHEMA_VERSION, $migrator->currentVersion());
    }

    #[DataProvider('legacySchemaVersionsProvider')]
    public function test_migrate_from_legacy_schema_version_reaches_current(int $legacyVersion): void
    {
        $pdo = LegacySchemaFixture::createSqlite();
        LegacySchemaFixture::seedAtVersion($pdo, $legacyVersion);
        WgwConnectionConfigurator::applyFromPdo($pdo);

        $this->assertSame($legacyVersion, self::legacyAppMigrationVersion($pdo));

        $version = app(WgwSchemaMigrator::class)->migratePdo($pdo);

        $this->assertSame(WgwSchemaMigrator::CURRENT_SCHEMA_VERSION, $version);
        $this->assertExpectedSchemaAtCurrentVersion();
    }

    public function test_migrate_tolerates_existing_meet_peer_owner_column(): void
    {
        $pdo = LegacySchemaFixture::createSqlite();
        LegacySchemaFixture::seedAtVersion($pdo, 3);
        WgwConnectionConfigurator::applyFromPdo($pdo);

        app(WgwSchemaMigrator::class)->migratePdo($pdo);

        $this->assertSame(WgwSchemaMigrator::CURRENT_SCHEMA_VERSION, app(WgwSchemaMigrator::class)->currentVersion());
        $this->assertTrue(Schema::connection('wgw')->hasColumn('meet_peers', 'owner_user'));
    }

    /**
     * @return array<string, array{0: int}>
     */
    public static function legacySchemaVersionsProvider(): array
    {
        $cases = [];
        for ($version = 0; $version <= 5; $version++) {
            $cases['legacy_v'.$version] = [$version];
        }

        return $cases;
    }

    private function assertExpectedSchemaAtCurrentVersion(): void
    {
        foreach ([
            'users',
            'principals',
            'groupmembers',
            'app_settings',
            'calendarobjects',
            'cards',
            'app_update_history',
            'meet_peers',
            'meet_messages',
            'api_refresh_tokens',
            'api_revoked_tokens',
            'drive_starred_items',
            'drive_shares',
            'drive_share_grants',
            'drive_share_sessions',
            'collab_peers',
            'collab_messages',
            'search_documents',
            'search_terms',
            'jmap_contact_states',
            'calendar_rsvp_tokens',
        ] as $table) {
            $this->assertTrue(
                Schema::connection('wgw')->hasTable($table),
                "Expected table {$table} to exist.",
            );
        }

        $this->assertTrue(Schema::connection('wgw')->hasColumn('meet_peers', 'owner_user'));
        $this->assertTrue(Schema::connection('wgw')->hasColumn('drive_share_grants', 'grantee_group'));
    }

    private static function legacyAppMigrationVersion(\PDO $pdo): int
    {
        try {
            $stmt = $pdo->query('SELECT MAX(version) FROM app_migrations');
            if ($stmt === false) {
                return 0;
            }

            return (int) ($stmt->fetchColumn() ?: 0);
        } catch (\PDOException) {
            return 0;
        }
    }
}
