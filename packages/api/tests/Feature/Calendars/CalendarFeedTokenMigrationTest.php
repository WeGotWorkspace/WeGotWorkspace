<?php

declare(strict_types=1);

namespace Tests\Feature\Calendars;

use App\Dav\Server\WgwCalendarBackendFactory;
use App\Models\CalendarFeedToken;
use App\Models\CalendarInstance;
use App\Models\Principal;
use App\Services\Calendars\CalendarFeedService;
use App\Services\Calendars\CollectionKind;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Sabre\CalDAV\Xml\Property\SupportedCalendarComponentSet;
use Tests\Support\CalendarsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;
use Tests\Support\WgwTestDatabase;

/**
 * Feeds published before tokens were bound to a calendar keep serving the
 * calendar they served before the update; tokens that served nothing are dropped.
 */
final class CalendarFeedTokenMigrationTest extends WgwDatabaseTestCase
{
    use CalendarsTestFixtures;

    private const MIGRATION = 'migrations/wgw/2026_10_28_000740_wgw_bind_calendar_feed_tokens_to_calendar.php';

    protected function setUp(): void
    {
        parent::setUp();
        if (WgwTestDatabase::driver() !== 'sqlite') {
            // MySQL commits DDL implicitly, which would end the per-test transaction.
            $this->markTestSkipped('Runs the migration down and up; SQLite keeps it inside the test transaction.');
        }
        $this->setUpCalendarsFixtures();
        $team = $this->seedWgwGroup('principals/groups/team', 'Team');
        foreach (['bob', 'carol'] as $username) {
            $principal = Principal::forUsername($username);
            $this->assertNotNull($principal);
            $this->addPrincipalToGroup($team, $principal);
        }
        $this->seedEventViaPdo('bob', 'bob.ics', $this->sampleIcs('Bob plan'));
        $this->seedTeamCalendar('planning', 'Team plan');
    }

    public function test_existing_tokens_keep_serving_the_calendar_they_served_before(): void
    {
        $migration = $this->migration();
        $migration->down();
        $this->assertTrue(Schema::connection('wgw')->hasColumn('calendar_feed_tokens', 'owner_username'));
        $this->assertFalse(Schema::connection('wgw')->hasColumn('calendar_feed_tokens', 'calendarid'));

        $this->insertLegacyToken('legacypersonal', 'bob', 'default');
        $this->insertLegacyToken('legacygroupbob', 'bob', 'planning');
        $this->insertLegacyToken('legacygroupcarol', 'carol', 'planning');
        $this->insertLegacyToken('legacyteamcalendar', 'bob', 'group-team');
        $this->insertLegacyToken('legacyunknownuser', 'dave', 'default');
        $this->insertLegacyToken('legacygonecalendar', 'bob', 'gone');

        $migration->up();

        $this->assertFalse(Schema::connection('wgw')->hasColumn('calendar_feed_tokens', 'owner_username'));
        $this->assertSame(4, CalendarFeedToken::query()->count());
        $this->get('/api/v1/calendars/feeds/legacypersonal')->assertOk()->assertSee('SUMMARY:Bob plan', false);
        $this->get('/api/v1/calendars/feeds/legacygroupbob')->assertOk()->assertSee('SUMMARY:Team plan', false);
        $this->get('/api/v1/calendars/feeds/legacygroupcarol')->assertOk()->assertSee('SUMMARY:Team plan', false);
        $this->get('/api/v1/calendars/feeds/legacyteamcalendar')->assertOk();
        $this->get('/api/v1/calendars/feeds/legacyunknownuser')->assertNotFound();
        $this->get('/api/v1/calendars/feeds/legacygonecalendar')->assertNotFound();

        $feeds = app(CalendarFeedService::class);
        $this->assertStringEndsWith('/calendars/feeds/legacypersonal', $feeds->show('bob', 'default')['httpsUrl']);
        $this->assertStringEndsWith('/calendars/feeds/legacygroupbob', $feeds->show('carol', 'planning')['httpsUrl']);

        $planning = CalendarInstance::query()->where('principaluri', 'principals/groups/team')->where('uri', 'planning')->firstOrFail();
        app(WgwCalendarBackendFactory::class)->make()->deleteCalendar([(int) $planning->calendarid, (int) $planning->id]);
        $this->get('/api/v1/calendars/feeds/legacygroupbob')->assertNotFound();
        $this->get('/api/v1/calendars/feeds/legacygroupcarol')->assertNotFound();
        $this->assertSame(2, CalendarFeedToken::query()->count());
    }

    public function test_down_restores_personal_feeds_and_up_binds_them_again(): void
    {
        $personal = $this->withBearer($this->issueBearerTokenFor('bob'))
            ->postJson('/api/v1/calendars/default/feed')
            ->assertCreated()
            ->json('httpsUrl');
        $this->withBearer($this->issueBearerTokenFor('carol'))
            ->postJson('/api/v1/calendars/planning/feed')
            ->assertCreated();

        $migration = $this->migration();
        $migration->down();

        $rows = DB::connection('wgw')->table('calendar_feed_tokens')->get(['owner_username', 'calendar_uri']);
        $this->assertCount(1, $rows);
        $this->assertSame('bob', $rows[0]->owner_username);
        $this->assertSame('default', $rows[0]->calendar_uri);

        $migration->up();

        $this->get('/api/v1/calendars/feeds/'.basename((string) parse_url((string) $personal, PHP_URL_PATH)))
            ->assertOk()
            ->assertSee('SUMMARY:Bob plan', false);
    }

    private function insertLegacyToken(string $raw, string $owner, string $calendarUri): void
    {
        DB::connection('wgw')->table('calendar_feed_tokens')->insert([
            'token_hash' => CalendarFeedToken::hashRaw($raw),
            'token_cipher' => Crypt::encryptString($raw),
            'owner_username' => $owner,
            'calendar_uri' => $calendarUri,
            'mode' => 'full',
        ]);
    }

    private function seedTeamCalendar(string $uri, string $eventTitle): void
    {
        $backend = app(WgwCalendarBackendFactory::class)->make();
        $backend->createCollection(CollectionKind::EventCalendar, 'principals/groups/team', $uri, [
            '{DAV:}displayname' => ucfirst($uri),
            '{urn:ietf:params:xml:ns:caldav}supported-calendar-component-set' => new SupportedCalendarComponentSet(['VEVENT']),
        ]);
        $instance = CalendarInstance::query()->where('principaluri', 'principals/groups/team')->where('uri', $uri)->firstOrFail();
        $backend->createCalendarObject([(int) $instance->calendarid, (int) $instance->id], $uri.'.ics', $this->sampleIcs($eventTitle));
    }

    private function migration(): object
    {
        $migration = require database_path(self::MIGRATION);
        $this->assertIsObject($migration);

        return $migration;
    }
}
