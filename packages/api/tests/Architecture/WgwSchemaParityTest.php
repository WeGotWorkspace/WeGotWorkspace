<?php

declare(strict_types=1);

namespace Tests\Architecture;

use Illuminate\Support\Facades\Schema;
use Tests\Support\WgwDatabaseTestCase;
use Tests\Support\WgwTestDatabase;

final class WgwSchemaParityTest extends WgwDatabaseTestCase
{
    public function test_wgw_migrations_create_expected_tables(): void
    {
        foreach ([
            'users',
            'principals',
            'groupmembers',
            'app_settings',
            'mail_user_credentials',
            'calendarobjects',
            'cards',
            'app_update_history',
            'api_refresh_tokens',
            'api_revoked_tokens',
            'meet_peers',
            'meet_messages',
            'collab_peers',
            'collab_messages',
            'drive_starred_items',
            'search_documents',
            'search_terms',
            'jmap_contact_states',
            'calendar_rsvp_tokens',
        ] as $table) {
            $this->assertTrue(
                Schema::connection('wgw')->hasTable($table),
                "Expected wgw table {$table} after migrate:fresh (driver: ".WgwTestDatabase::driver().').',
            );
        }

        $this->assertTrue(Schema::connection('wgw')->hasColumn('meet_peers', 'owner_user'));
    }
}
