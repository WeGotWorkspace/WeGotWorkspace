<?php

declare(strict_types=1);

namespace Tests\Feature\Calendars;

use App\Dav\Server\WgwCalendarBackendFactory;
use App\Models\CalendarFeedToken;
use App\Models\CalendarInstance;
use App\Models\Principal;
use App\Services\Calendars\CalendarFeedService;
use App\Services\Calendars\CollectionKind;
use App\Services\Installer\WgwSchemaMigrator;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Sabre\CalDAV\Xml\Property\SupportedCalendarComponentSet;
use Tests\Support\CalendarsTestFixtures;
use Tests\Support\InstallerMysqlTestDatabase;
use Tests\Support\WgwDatabaseTestCase;
use Tests\Support\WgwTestDatabase;

/**
 * Feeds published before tokens were bound to a calendar keep serving the
 * calendar they served before the update; tokens that served nothing are dropped.
 *
 * The migration runs down and up inside each test. SQLite keeps that DDL in
 * the per-test transaction. MySQL commits DDL implicitly, so on MySQL each test
 * gets its own freshly migrated database instead of the shared transaction.
 */
final class CalendarFeedTokenMigrationTest extends WgwDatabaseTestCase
{
    use CalendarsTestFixtures;

    private const MIGRATION = 'migrations/wgw/2026_10_28_000750_wgw_bind_calendar_feed_tokens_to_calendar.php';

    private ?string $isolatedDatabase = null;

    protected function setUp(): void
    {
        parent::setUp();
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

    protected function tearDown(): void
    {
        $database = $this->isolatedDatabase;
        parent::tearDown();
        if ($database !== null) {
            InstallerMysqlTestDatabase::drop($database);
        }
    }

    protected function beforeRefreshingDatabase(): void
    {
        parent::beforeRefreshingDatabase();
        if (WgwTestDatabase::driver() !== 'mysql') {
            return;
        }
        $this->isolatedDatabase = InstallerMysqlTestDatabase::createIsolated();
        config(['database.connections.wgw.database' => $this->isolatedDatabase]);
        DB::purge('wgw');
    }

    protected function refreshTestDatabase(): void
    {
        if ($this->isolatedDatabase === null) {
            parent::refreshTestDatabase();

            return;
        }
        Artisan::call('migrate:fresh', array_merge(['--force' => true], $this->migrateFreshUsing()));
        $this->app[Kernel::class]->setArtisan(null);
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
        $this->assertFeedTokensCascadeWithCalendar();

        $migration->up();
        app(WgwSchemaMigrator::class)->migrate();
        $this->assertFeedTokensCascadeWithCalendar();

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
        $this->assertFeedTokensCascadeWithCalendar();

        $this->get('/api/v1/calendars/feeds/'.basename((string) parse_url((string) $personal, PHP_URL_PATH)))
            ->assertOk()
            ->assertSee('SUMMARY:Bob plan', false);
    }

    private function assertFeedTokensCascadeWithCalendar(): void
    {
        $foreignKeys = array_values(array_filter(
            Schema::connection('wgw')->getForeignKeys('calendar_feed_tokens'),
            static fn (array $foreignKey): bool => $foreignKey['columns'] === ['calendarid'],
        ));
        $this->assertCount(1, $foreignKeys);
        $this->assertSame('calendars', $foreignKeys[0]['foreign_table']);
        $this->assertSame(['id'], $foreignKeys[0]['foreign_columns']);
        $this->assertSame('cascade', strtolower((string) $foreignKeys[0]['on_delete']));

        if ($this->isolatedDatabase === null) {
            return;
        }
        $engines = DB::connection('wgw')->select(
            'SELECT LOWER(engine) AS table_engine FROM information_schema.tables WHERE table_schema = ? AND table_name IN (?, ?)',
            [$this->isolatedDatabase, 'calendars', 'calendar_feed_tokens'],
        );
        $this->assertSame(['innodb', 'innodb'], array_map(static fn (object $row): string => (string) $row->table_engine, $engines));
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
