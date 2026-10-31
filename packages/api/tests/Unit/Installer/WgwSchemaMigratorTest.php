<?php

declare(strict_types=1);

namespace Tests\Unit\Installer;

use App\Models\DriveShare;
use App\Models\DriveShareGrant;
use App\Services\Installer\WgwSchemaMigrator;
use App\Support\WgwConnectionConfigurator;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
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

    public function test_hash_token_down_restores_plaintext_before_dropping_columns(): void
    {
        app(WgwSchemaMigrator::class)->migrate();

        $shareId = (string) Str::uuid();
        $grantId = (string) Str::uuid();
        $now = Carbon::now();
        $publicToken = 'legacy-public-token-0123456789abcd';
        $inviteToken = 'example-invite-token';

        DB::connection('wgw')->table('drive_shares')->insert([
            'id' => $shareId,
            'path' => '/users/bob/shared.md',
            'owner_username' => 'bob',
            'kind' => 'public',
            'default_access' => 'view',
            'public_token' => null,
            'public_token_hash' => DriveShare::hashPublicToken($publicToken),
            'public_token_cipher' => Crypt::encryptString($publicToken),
            'created_at' => $now,
            'updated_at' => $now,
        ]);
        DB::connection('wgw')->table('drive_share_grants')->insert([
            'id' => $grantId,
            'share_id' => $shareId,
            'grantee_type' => 'email',
            'grantee_email' => 'legacy@example.com',
            'access' => 'view',
            'status' => 'pending',
            'invite_token' => null,
            'invite_token_hash' => DriveShareGrant::hashInviteToken($inviteToken),
            'invite_token_cipher' => Crypt::encryptString($inviteToken),
            'invite_expires_at' => $now,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        $migration = require database_path('migrations/wgw/2026_10_13_000460_wgw_hash_drive_share_tokens.php');
        $migration->down();

        $this->assertFalse(Schema::connection('wgw')->hasColumn('drive_shares', 'public_token_cipher'));
        $this->assertFalse(Schema::connection('wgw')->hasColumn('drive_share_grants', 'invite_token_cipher'));

        $share = DB::connection('wgw')->table('drive_shares')->where('id', $shareId)->first();
        $grant = DB::connection('wgw')->table('drive_share_grants')->where('id', $grantId)->first();
        $this->assertNotNull($share);
        $this->assertNotNull($grant);
        $this->assertSame($publicToken, $share->public_token);
        $this->assertSame($inviteToken, $grant->invite_token);
    }

    public function test_rtc_hardening_down_drops_collab_browser_id_only_when_present(): void
    {
        app(WgwSchemaMigrator::class)->migrate();
        $this->assertTrue(Schema::connection('wgw')->hasColumn('collab_peers', 'browser_id'));

        Schema::connection('wgw')->table('collab_peers', function (Blueprint $table): void {
            $table->dropColumn('browser_id');
        });

        $migration = require database_path('migrations/wgw/2026_10_03_000440_wgw_rtc_signaling_hardening.php');
        $migration->down();

        $this->assertFalse(Schema::connection('wgw')->hasColumn('collab_peers', 'browser_id'));
        $this->assertFalse(Schema::connection('wgw')->hasColumn('collab_peers', 'access'));
    }

    public function test_refresh_token_grace_down_drops_added_columns(): void
    {
        app(WgwSchemaMigrator::class)->migrate();
        $this->assertTrue(Schema::connection('wgw')->hasColumn('api_refresh_tokens', 'successor_token'));

        $migration = require database_path('migrations/wgw/2026_10_16_000640_wgw_refresh_token_rotation_grace.php');
        $migration->down();

        $this->assertFalse(Schema::connection('wgw')->hasColumn('api_refresh_tokens', 'family_id'));
        $this->assertFalse(Schema::connection('wgw')->hasColumn('api_refresh_tokens', 'rotated_at'));
        $this->assertFalse(Schema::connection('wgw')->hasColumn('api_refresh_tokens', 'successor_hash'));
        $this->assertFalse(Schema::connection('wgw')->hasColumn('api_refresh_tokens', 'successor_token'));
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
            'calendar_collection_meta',
            'cards',
            'app_update_history',
            'meet_peers',
            'meet_messages',
            'meet_reservations',
            'api_refresh_tokens',
            'api_password_reset_tokens',
            'api_revoked_tokens',
            'drive_starred_items',
            'drive_shares',
            'drive_share_grants',
            'drive_share_sessions',
            'collab_peers',
            'collab_messages',
            'principal_peers',
            'principal_messages',
            'search_documents',
            'search_terms',
            'jmap_contact_states',
            'calendar_rsvp_tokens',
            'calendar_subscriptions',
            'calendar_feed_tokens',
            'calendar_share_dismissals',
            'addressbook_shares',
            'addressbook_share_dismissals',
            'note_stars',
            'note_yjs_state',
            'doc_yjs_state',
            'jmap_note_states',
            'oauth_clients',
            'oauth_auth_codes',
            'oauth_access_tokens',
            'oauth_refresh_tokens',
            'oauth_device_codes',
            'mcp_audit_events',
            'mcp_sessions',
            'docs_thread_index',
            'notifications',
            'notification_deliveries',
            'push_subscriptions',
            'rtc_relay_events',
        ] as $table) {
            $this->assertTrue(
                Schema::connection('wgw')->hasTable($table),
                "Expected table {$table} to exist.",
            );
        }

        $this->assertTrue(Schema::connection('wgw')->hasColumn('meet_peers', 'owner_user'));
        $this->assertTrue(Schema::connection('wgw')->hasColumn('meet_peers', 'admitted'));
        $this->assertTrue(Schema::connection('wgw')->hasColumn('meet_peers', 'browser_id'));
        $this->assertTrue(Schema::connection('wgw')->hasColumn('drive_share_grants', 'grantee_group'));
        $this->assertTrue(Schema::connection('wgw')->hasColumn('drive_shares', 'public_token_hash'));
        $this->assertTrue(Schema::connection('wgw')->hasColumn('drive_shares', 'public_token_cipher'));
        $this->assertTrue(Schema::connection('wgw')->hasColumn('drive_share_grants', 'invite_token_hash'));
        $this->assertTrue(Schema::connection('wgw')->hasColumn('drive_share_grants', 'invite_expires_at'));
        $this->assertTrue(Schema::connection('wgw')->hasColumn('chat_channel_meta', 'default_for_group'));
        $this->assertTrue(Schema::connection('wgw')->hasColumn('users', 'enabled'));
        $this->assertTrue(Schema::connection('wgw')->hasColumn('users', 'ui_session_epoch'));
        $this->assertTrue(Schema::connection('wgw')->hasColumn('api_refresh_tokens', 'family_id'));
        $this->assertTrue(Schema::connection('wgw')->hasColumn('api_refresh_tokens', 'rotated_at'));
        $this->assertTrue(Schema::connection('wgw')->hasColumn('api_refresh_tokens', 'successor_hash'));
        $this->assertTrue(Schema::connection('wgw')->hasColumn('api_refresh_tokens', 'successor_token'));
        $this->assertTrue(Schema::connection('wgw')->hasColumn('calendar_feed_tokens', 'mode'));
        $this->assertTrue(Schema::connection('wgw')->hasColumn('calendar_feed_tokens', 'calendarid'));
        // Format-at-edge notify facts; without this column NotifyListener inserts are
        // swallowed by EventDispatch and chat/docs/calendar inbox rows never appear.
        $this->assertTrue(Schema::connection('wgw')->hasColumn('notifications', 'data'));
        $starIndexes = collect(Schema::connection('wgw')->getIndexes('drive_starred_items'))
            ->pluck('name')
            ->all();
        $this->assertContains('idx_drive_starred_path', $starIndexes);

        $this->assertRtcSignalingSchema();
    }

    /**
     * Contract C9 of the real-time hardening programme: one migration carries
     * every schema change, so a fresh install and an upgrade both land here.
     */
    private function assertRtcSignalingSchema(): void
    {
        foreach (['meet_peers', 'collab_peers', 'principal_peers'] as $table) {
            foreach (['caps', 'net'] as $column) {
                $this->assertTrue(
                    Schema::connection('wgw')->hasColumn($table, $column),
                    "Expected column {$table}.{$column} to exist.",
                );
            }
            $this->assertContains(
                'idx_'.str_replace('_peers', '', $table).'_peers_seen',
                collect(Schema::connection('wgw')->getIndexes($table))->pluck('name')->all(),
            );
        }

        foreach (['meet_messages', 'collab_messages', 'principal_messages'] as $table) {
            $this->assertContains(
                'idx_'.str_replace('_messages', '', $table).'_msg_created',
                collect(Schema::connection('wgw')->getIndexes($table))->pluck('name')->all(),
            );
        }

        $this->assertTrue(Schema::connection('wgw')->hasColumn('collab_peers', 'access'));
        $this->assertTrue(Schema::connection('wgw')->hasColumn('collab_peers', 'browser_id'));
        $this->assertTrue(Schema::connection('wgw')->hasColumn('principal_peers', 'browser_id'));

        // Fail-closed default: a collab peer row that was not written by join
        // comes back as read-only.
        Schema::connection('wgw')->getConnection()->table('collab_peers')->insert([
            'room' => 'schema-default-probe',
            'peer_id' => '0123456789abcdef',
            'name' => 'probe',
            'owner_user' => 'u:probe',
            'seen_at' => time(),
        ]);
        $this->assertSame('read', (string) Schema::connection('wgw')->getConnection()
            ->table('collab_peers')
            ->where('room', 'schema-default-probe')
            ->value('access'));

        foreach (['created_at', 'channel', 'actor', 'reason', 'outcome'] as $column) {
            $this->assertTrue(Schema::connection('wgw')->hasColumn('rtc_relay_events', $column));
        }
        $this->assertFalse(Schema::connection('wgw')->hasTable('rtc_session_metrics'));
        $this->assertContains(
            'idx_rtc_relay_events_created',
            collect(Schema::connection('wgw')->getIndexes('rtc_relay_events'))->pluck('name')->all(),
        );
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
