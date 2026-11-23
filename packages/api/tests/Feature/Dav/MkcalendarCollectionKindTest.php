<?php

declare(strict_types=1);

namespace Tests\Feature\Dav;

use App\Models\CalendarInstance;
use App\Models\ProjectResource;
use App\Services\Calendars\CollectionKind;
use App\Services\Calendars\UserCalendarCollectionsProvisioner;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Tests\Support\WgwDatabaseTestCase;
use Tests\Support\WgwInstallFixture;

/**
 * MKCALENDAR states no kind. The backend derives one from the component set,
 * which is the only derivation left in the system.
 */
final class MkcalendarCollectionKindTest extends WgwDatabaseTestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        $this->configureWgwJwtKeys();

        $installRoot = sys_get_temp_dir().'/wgw-mkcal-kind-'.uniqid('', true);
        mkdir($installRoot, 0775, true);
        file_put_contents($installRoot.'/index.php', "<?php\n");
        $dataDir = $installRoot.'/wgw-content';
        mkdir($dataDir.'/files/users/alice', 0775, true);
        WgwInstallFixture::bindInstallRoot($installRoot, $dataDir);
        WgwInstallFixture::markInstalled($installRoot, $dataDir, 'alice');
        config(['wgw.install_root' => $installRoot, 'wgw.data_dir' => $dataDir]);
        WgwInstallFixture::forgetInstallBindings();
        WgwInstallFixture::purgeDatabaseConnection();

        app(UserCalendarCollectionsProvisioner::class)->ensureForPrincipal('principals/alice');
    }

    public function test_vjournal_mkcalendar_is_a_notebook(): void
    {
        $this->dav('MKCOL', '/calendars/alice/external-journal/', $this->mkcolCalendarXml('External journal', 'VJOURNAL'), [
            'CONTENT_TYPE' => 'application/xml',
        ])->assertCreated();

        $this->assertSame(
            CollectionKind::Notebook->value,
            $this->kindFor('principals/alice', 'external-journal'),
        );

        $ids = array_column(
            $this->asUser('alice')->getJson('/api/v1/notes/notebooks')->assertOk()->json('list'),
            'id',
        );
        $this->assertContains('external-journal', $ids);
    }

    public function test_vevent_mkcalendar_is_an_event_calendar(): void
    {
        $this->dav('MKCOL', '/calendars/alice/external-events/', $this->mkcolCalendarXml('External events', 'VEVENT'), [
            'CONTENT_TYPE' => 'application/xml',
        ])->assertCreated();

        $this->assertSame(
            CollectionKind::EventCalendar->value,
            $this->kindFor('principals/alice', 'external-events'),
        );
    }

    public function test_a_real_mkcalendar_makes_a_personal_collection_of_the_kind_the_components_name(): void
    {
        foreach (['VEVENT' => CollectionKind::EventCalendar, 'VTODO' => CollectionKind::TaskList, 'VJOURNAL' => CollectionKind::Notebook] as $component => $kind) {
            $uri = 'made-'.strtolower($component);
            $this->dav('MKCALENDAR', '/calendars/alice/'.$uri.'/', $this->mkcalendarXml('  Made '.$component.'  ', $component, ' #123456 '), [
                'CONTENT_TYPE' => 'application/xml',
            ])->assertCreated();

            $this->assertSame($kind->value, $this->kindFor('principals/alice', $uri));
            $instance = CalendarInstance::query()->where('principaluri', 'principals/alice')->where('uri', $uri)->firstOrFail();
            $this->assertSame('Made '.$component, $instance->displayname);
            $this->assertSame('#123456', $instance->calendarcolor);
            $this->assertSame(
                0,
                ProjectResource::query()->where('locator', (string) $instance->calendarid)->count(),
                'No Project owns a personal collection.',
            );
        }
        $this->assertSame(0, DB::connection('wgw')->table('projects')->count(), 'No Project is created for it.');
    }

    public function test_a_calendar_needs_a_display_name_when_it_sends_one(): void
    {
        $this->dav('MKCALENDAR', '/calendars/alice/blank-name/', $this->mkcalendarXml('   ', 'VEVENT'), [
            'CONTENT_TYPE' => 'application/xml',
        ])->assertStatus(400);

        $this->assertSame(0, CalendarInstance::query()->where('uri', 'blank-name')->count());
    }

    public function test_a_calendar_cannot_be_made_in_a_team_home_or_in_another_users_home(): void
    {
        $this->seedWgwUser('bob', displayName: 'Bob');
        $this->seedSharedTeam('t1', 'alice', 'bob');
        $this->appointTeamAdmin('t1', 'alice');
        $before = CalendarInstance::query()->count();

        foreach (['MKCALENDAR', 'MKCOL'] as $method) {
            foreach (['/calendars/groups/t1/team-made/', '/calendars/bob/bob-made/'] as $path) {
                $body = $method === 'MKCOL' ? $this->mkcolCalendarXml('Nope', 'VEVENT') : $this->mkcalendarXml('Nope', 'VEVENT');
                $this->dav($method, $path, $body, ['CONTENT_TYPE' => 'application/xml'])->assertForbidden();
            }
        }

        $this->assertSame($before, CalendarInstance::query()->count(), 'Nothing was created.');
    }

    public function test_reserved_uri_prefixes_stay_refused_over_mkcalendar(): void
    {
        $this->dav('MKCALENDAR', '/calendars/alice/chat-shadow/', $this->mkcalendarXml('Shadow', 'VEVENT'), [
            'CONTENT_TYPE' => 'application/xml',
        ])->assertForbidden();
    }

    private function kindFor(string $principalUri, string $uri): string
    {
        $calendarId = CalendarInstance::query()
            ->where('principaluri', $principalUri)
            ->where('uri', $uri)
            ->value('calendarid');
        $this->assertNotNull($calendarId);

        return (string) DB::connection('wgw')->table('calendar_collection_meta')
            ->where('calendarid', $calendarId)
            ->value('kind');
    }

    private function asUser(string $username)
    {
        return $this->withBearer($this->issueBearerTokenFor($username));
    }

    /**
     * @param  array<string, string>  $extraServer
     */
    private function dav(
        string $method,
        string $path,
        ?string $body = null,
        array $extraServer = [],
        ?string $depth = null,
        string $username = 'alice',
    ): TestResponse {
        $server = array_merge([
            'HTTP_AUTHORIZATION' => 'Basic '.base64_encode($username.':secret'),
        ], $extraServer);
        if ($depth !== null) {
            $server['HTTP_DEPTH'] = $depth;
        }
        if ($body !== null) {
            $server['CONTENT_LENGTH'] = (string) strlen($body);
        }

        return $this->call($method, $path, [], [], [], $server, $body);
    }

    private function mkcalendarXml(string $displayName, string $component, ?string $color = null): string
    {
        $colorProp = $color === null ? '' : '<a:calendar-color xmlns:a="http://apple.com/ns/ical/">'.$color.'</a:calendar-color>';

        return <<<XML
<?xml version="1.0" encoding="utf-8" ?>
<c:mkcalendar xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:set>
    <d:prop>
      <d:displayname>{$displayName}</d:displayname>
      {$colorProp}
      <c:supported-calendar-component-set>
        <c:comp name="{$component}"/>
      </c:supported-calendar-component-set>
    </d:prop>
  </d:set>
</c:mkcalendar>
XML;
    }

    private function mkcolCalendarXml(string $displayName, string $component): string
    {
        return <<<XML
<?xml version="1.0" encoding="utf-8" ?>
<d:mkcol xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:set>
    <d:prop>
      <d:resourcetype><d:collection/><c:calendar/></d:resourcetype>
      <d:displayname>{$displayName}</d:displayname>
      <c:supported-calendar-component-set>
        <c:comp name="{$component}"/>
      </c:supported-calendar-component-set>
    </d:prop>
  </d:set>
</d:mkcol>
XML;
    }
}
