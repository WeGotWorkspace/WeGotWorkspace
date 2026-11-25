<?php

declare(strict_types=1);

namespace Tests\Feature\Calendars;

use App\Dav\Server\WgwCalendarBackendFactory;
use App\Models\Principal;
use App\Services\Calendars\CollectionKind;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Sabre\CalDAV\Xml\Property\SupportedCalendarComponentSet;
use Tests\Support\CalendarsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/** Backfill and resume of the `calendar_subscriptions` key migration (#2367). */
final class CalendarSubscriptionsPrincipalMigrationTest extends WgwDatabaseTestCase
{
    use CalendarsTestFixtures;

    protected function calendarFixtureUsersShareATeam(): bool
    {
        return false;
    }

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpCalendarsFixtures();
        $this->restoreOldSchema();
    }

    public function test_two_teams_with_a_same_named_feed_each_get_their_own_row(): void
    {
        $this->teamCalendar('team-a', 'villa', 'Villa');
        $this->teamCalendar('team-b', 'villa', 'Villa');
        $this->join('team-a', 'bob');
        $this->join('team-b', 'carol');
        $this->row('r-bob', 'bob', 'villa', 'Villa');
        $this->row('r-carol', 'carol', 'villa', 'Villa');

        $this->migrate();

        $this->assertSame('principals/groups/team-a', $this->principalOf('r-bob'));
        $this->assertSame('principals/groups/team-b', $this->principalOf('r-carol'));
        $this->assertTrue(Schema::connection('wgw')->hasIndex('calendar_subscriptions', ['principal_uri', 'calendar_uri'], 'unique'));
        $this->assertFalse(Schema::connection('wgw')->hasIndex('calendar_subscriptions', ['username', 'calendar_uri'], 'unique'));
    }

    public function test_members_of_both_teams_with_identical_names_do_not_claim_the_same_calendar(): void
    {
        $this->teamCalendar('team-a', 'villa', 'Villa');
        $this->teamCalendar('team-b', 'villa', 'Villa');
        foreach (['team-a', 'team-b'] as $slug) {
            $this->join($slug, 'bob');
            $this->join($slug, 'carol');
        }
        $this->row('r-bob', 'bob', 'villa', 'Villa');
        $this->row('r-carol', 'carol', 'villa', 'Villa');

        $this->migrate();

        foreach (['r-bob', 'r-carol'] as $id) {
            $this->assertNotContains($this->principalOf($id), ['principals/groups/team-a', 'principals/groups/team-b']);
        }
    }

    public function test_two_members_whose_rows_pick_the_same_calendar_are_both_parked(): void
    {
        $this->teamCalendar('team-a', 'villa', 'Villa');
        $this->teamCalendar('team-b', 'villa', 'Villa');
        $this->join('team-a', 'bob');
        $this->join('team-a', 'carol');
        $this->row('r-bob', 'bob', 'villa', 'Villa');
        $this->row('r-carol', 'carol', 'villa', 'Villa');

        $this->migrate();

        $this->assertSame('principals/bob', $this->principalOf('r-bob'));
        $this->assertSame('principals/carol', $this->principalOf('r-carol'));
        $this->assertTrue(Schema::connection('wgw')->hasIndex('calendar_subscriptions', ['principal_uri', 'calendar_uri'], 'unique'));
    }

    public function test_a_name_match_is_not_kept_when_another_row_claims_the_same_calendar(): void
    {
        $this->teamCalendar('team-a', 'villa', 'Villa');
        $this->join('team-a', 'bob');
        $this->join('team-a', 'carol');
        $this->seedNamedCalendarFor('carol', 'villa', 'My Villa');
        $this->row('r-bob', 'bob', 'villa', 'Villa');
        $this->row('r-carol', 'carol', 'villa', 'Villa');

        $this->migrate();

        $this->assertSame('principals/bob', $this->principalOf('r-bob'));
        $this->assertSame('principals/carol#unresolved-r-carol', $this->principalOf('r-carol'));
        $this->assertTrue(Schema::connection('wgw')->hasIndex('calendar_subscriptions', ['principal_uri', 'calendar_uri'], 'unique'));
    }

    public function test_a_row_is_parked_when_a_row_from_an_earlier_run_holds_the_calendar(): void
    {
        $this->teamCalendar('team-a', 'villa', 'Villa');
        $this->join('team-a', 'bob');
        $this->join('team-a', 'carol');
        $this->row('r-bob', 'bob', 'villa', 'Villa');
        $this->migrate();
        $this->assertSame('principals/groups/team-a', $this->principalOf('r-bob'));

        Schema::connection('wgw')->table('calendar_subscriptions', fn (Blueprint $table) => $table->dropUnique(['principal_uri', 'calendar_uri']));
        $this->row('r-carol', 'carol', 'villa', 'Villa');
        $this->migrate();

        $this->assertSame('principals/groups/team-a', $this->principalOf('r-bob'));
        $this->assertSame('principals/carol', $this->principalOf('r-carol'));
    }

    public function test_a_row_with_one_candidate_follows_it_even_when_the_name_differs(): void
    {
        $this->teamCalendar('team-a', 'villa', 'Renamed');
        $this->join('team-a', 'bob');
        $this->row('r-bob', 'bob', 'villa', 'Villa');

        $this->migrate();

        $this->assertSame('principals/groups/team-a', $this->principalOf('r-bob'));
    }

    public function test_a_team_row_is_not_attached_to_a_team_the_user_is_not_in(): void
    {
        $this->teamCalendar('team-a', 'villa', 'Villa');
        $this->row('r-bob', 'bob', 'villa', 'Villa');

        $this->migrate();

        $this->assertSame('principals/bob', $this->principalOf('r-bob'));
    }

    public function test_an_unsettled_row_is_parked_when_the_user_owns_a_personal_calendar_with_the_uri(): void
    {
        $this->teamCalendar('team-a', 'villa', 'Alpha');
        $this->teamCalendar('team-b', 'villa', 'Beta');
        $this->join('team-a', 'carol');
        $this->join('team-b', 'carol');
        $this->seedNamedCalendarFor('carol', 'villa', 'Personal');
        $this->row('r-carol', 'carol', 'villa', 'Unknown');

        $this->migrate();

        $this->assertSame('principals/carol#unresolved-r-carol', $this->principalOf('r-carol'));
    }

    public function test_the_calendar_name_picks_between_candidates_including_a_personal_copy(): void
    {
        $this->teamCalendar('team-a', 'villa', 'Alpha');
        $this->teamCalendar('team-b', 'villa', 'Beta');
        $this->join('team-a', 'bob');
        $this->join('team-b', 'bob');
        $this->row('r-bob', 'bob', 'villa', 'Beta');

        $this->seedNamedCalendarFor('carol', 'villa', 'Personal');
        $this->join('team-a', 'carol');
        $this->row('r-carol', 'carol', 'villa', 'Alpha');

        $this->migrate();

        $this->assertSame('principals/groups/team-b', $this->principalOf('r-bob'));
        $this->assertSame('principals/groups/team-a', $this->principalOf('r-carol'));
    }

    public function test_a_row_without_a_calendar_falls_back_to_the_personal_principal(): void
    {
        $this->row('r-lost', 'bob', 'gone', 'Gone');

        $this->migrate();

        $this->assertSame('principals/bob', $this->principalOf('r-lost'));
    }

    public function test_a_run_that_stopped_after_adding_the_column_finishes_on_the_next_run(): void
    {
        $this->teamCalendar('team-a', 'villa', 'Villa');
        $this->join('team-a', 'bob');
        $this->row('r-bob', 'bob', 'villa', 'Villa');

        $this->migrate();
        // Simulates a crash after the old key was dropped and before the new one existed.
        Schema::connection('wgw')->table('calendar_subscriptions', fn (Blueprint $table) => $table->dropUnique(['principal_uri', 'calendar_uri']));
        $this->migrate();

        $this->assertTrue(Schema::connection('wgw')->hasIndex('calendar_subscriptions', ['principal_uri', 'calendar_uri'], 'unique'));
        $this->assertSame('principals/groups/team-a', $this->principalOf('r-bob'));
    }

    private function migrate(): void
    {
        $migration = require base_path('database/migrations/wgw/2026_11_25_000990_wgw_calendar_subscriptions_key_on_principal.php');
        $migration->up();
    }

    /** Back to the schema before this migration: no principal column, unique on user and uri. */
    private function restoreOldSchema(): void
    {
        Schema::connection('wgw')->table('calendar_subscriptions', function (Blueprint $table): void {
            $table->dropUnique(['principal_uri', 'calendar_uri']);
            $table->unique(['username', 'calendar_uri']);
            $table->dropColumn('principal_uri');
        });
    }

    private function row(string $id, string $username, string $uri, string $name): void
    {
        DB::connection('wgw')->table('calendar_subscriptions')->insert([
            'id' => $id,
            'username' => $username,
            'calendar_uri' => $uri,
            'url' => 'https://feeds.example.test/'.$id.'.ics',
            'name' => $name,
        ]);
    }

    private function principalOf(string $id): string
    {
        return (string) DB::connection('wgw')->table('calendar_subscriptions')->where('id', $id)->value('principal_uri');
    }

    private function teamCalendar(string $slug, string $uri, string $name): void
    {
        if (Principal::query()->where('uri', 'principals/groups/'.$slug)->doesntExist()) {
            $this->seedWgwGroup('principals/groups/'.$slug, $slug);
        }
        app(WgwCalendarBackendFactory::class)->make()->createCollection(
            CollectionKind::EventCalendar,
            'principals/groups/'.$slug,
            $uri,
            [
                '{DAV:}displayname' => $name,
                '{urn:ietf:params:xml:ns:caldav}supported-calendar-component-set' => new SupportedCalendarComponentSet(['VEVENT']),
            ],
        );
    }

    private function join(string $slug, string $username): void
    {
        $this->addPrincipalToGroup(
            Principal::query()->where('uri', 'principals/groups/'.$slug)->firstOrFail(),
            Principal::forUsername($username) ?? $this->fail('user'),
        );
    }
}
