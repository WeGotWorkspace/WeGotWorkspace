<?php

declare(strict_types=1);

namespace Tests\Feature\Admin;

use App\Models\User;
use App\Services\Admin\AdminGroupManagementService;
use App\Services\Auth\AdminRoleResolver;
use App\Services\Calendars\CalendarCollectionAccess;
use App\Services\Calendars\CollectionKind;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\Schema;
use Tests\Support\LegacyAdministratorsTeam;
use Tests\Support\SeedsWgwIdentity;
use Tests\Support\WgwDatabaseTestCase;

/**
 * #1925: an instance upgraded from the `administrators` group keeps every admin,
 * and the group stays a working Team "Administrators".
 */
final class AdminRoleMigrationTest extends WgwDatabaseTestCase
{
    use SeedsWgwIdentity;

    private const MIGRATION = 'database/migrations/wgw/2026_11_08_000910_wgw_users_admin_role.php';

    protected function setUp(): void
    {
        parent::setUp();
        $this->configureWgwJwtKeys();
        $this->seedWgwUser('alice', displayName: 'Alice');
        $this->seedWgwUser('bob', displayName: 'Bob');
        $this->seedWgwUser('carol', displayName: 'Carol');

        // The instance before #1925: alice and bob are admins through the group.
        app(AdminGroupManagementService::class)->create('administrators', 'Administrators');
        app(AdminGroupManagementService::class)->update('administrators', null, ['alice', 'bob']);
        $this->migration()->down();
        $this->assertFalse(Schema::connection('wgw')->hasColumn('users', 'is_admin'));
    }

    public function test_every_member_of_administrators_keeps_admin_and_nobody_else_gets_it(): void
    {
        $this->migration()->up();

        $this->assertTrue(User::query()->where('username', 'alice')->value('is_admin'));
        $this->assertTrue(User::query()->where('username', 'bob')->value('is_admin'));
        $this->assertFalse(User::query()->where('username', 'carol')->value('is_admin'));

        $roles = new AdminRoleResolver;
        $this->assertTrue($roles->isAdmin('alice'));
        $this->assertTrue($roles->isAdmin('bob'));
        $this->assertFalse($roles->isAdmin('carol'));

        $this->withBearer($this->issueBearerTokenFor('bob'))
            ->getJson('/api/v1/admin/state')
            ->assertOk();
        $this->withBearer($this->issueBearerTokenFor('carol'))
            ->getJson('/api/v1/admin/state')
            ->assertForbidden();
    }

    public function test_the_old_group_stays_a_team_whose_members_keep_its_channel_calendar_and_files(): void
    {
        $this->migration()->up();
        // Running twice changes nothing (re-run after a failed upgrade).
        $this->migration()->up();

        foreach (['alice', 'bob'] as $username) {
            $token = $this->issueBearerTokenFor($username);

            $state = $this->withBearer($token)->getJson('/api/v1/settings/state')->assertOk();
            $this->assertTrue($state->json('isAdmin'));
            $this->assertContains(
                ['id' => LegacyAdministratorsTeam::URI, 'displayName' => 'Administrators'],
                $state->json('groups'),
            );

            $files = $this->withBearer($token)->getJson('/api/v1/files/children?path=/groups')->assertOk();
            $this->assertContains('administrators', array_column((array) $files->json('data.files'), 'name'));

            $channels = (array) $this->withBearer($token)->getJson('/api/v1/chat/channels')->assertOk()->json('list');
            $this->assertContains('administrators', array_column($channels, 'groupSlug'));

            $calendars = app(CalendarCollectionAccess::class)->accessibleInstances($username, CollectionKind::EventCalendar);
            $this->assertContains(
                LegacyAdministratorsTeam::URI,
                $calendars->pluck('principaluri')->map(static fn (mixed $uri): string => (string) $uri)->all(),
            );
        }

        // Accepted consequence (2026-11-04): the old admins share this Team.
        $carolGroups = $this->withBearer($this->issueBearerTokenFor('carol'))
            ->getJson('/api/v1/settings/state')
            ->assertOk()
            ->json('groups');
        $this->assertSame([], $carolGroups);
    }

    private function migration(): Migration
    {
        $migration = require base_path(self::MIGRATION);
        $this->assertInstanceOf(Migration::class, $migration);

        return $migration;
    }
}
