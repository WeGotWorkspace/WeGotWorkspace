<?php

declare(strict_types=1);

namespace Tests\Feature\Dav;

use App\Models\CalendarInstance;
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
