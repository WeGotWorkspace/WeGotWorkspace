<?php

declare(strict_types=1);

namespace Tests\Feature\Calendars;

use App\Services\Calendars\CalendarCollectionUris;
use App\Services\Tasks\InboxTaskListProvisioner;
use App\Support\WgwSettings;
use Illuminate\Support\Facades\DB;
use Sabre\CalDAV\Backend\PDO as CalPDO;
use Sabre\CalDAV\CalendarHome;
use Sabre\CalDAV\Schedule\Inbox;
use Tests\Support\CalendarsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;
use Tests\Support\WgwInstallFixture;

/**
 * Pins the CalDAV calendar-home /inbox collision: Tasks VTODO uri is not `inbox`.
 */
final class CalendarsSchedulingInboxUriTest extends WgwDatabaseTestCase
{
    use CalendarsTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpCalendarsFixtures();
        $this->setAppSetting(WgwSettings::CALENDAR_ENABLED, true);
        app(InboxTaskListProvisioner::class)->ensureForPrincipal('principals/bob');
    }

    public function test_calendar_home_has_one_inbox_child_that_is_the_schedule_inbox(): void
    {
        $home = new CalendarHome(new CalPDO(DB::connection('wgw')->getPdo()), [
            'uri' => 'principals/bob',
        ]);

        $names = [];
        $inboxNamed = [];
        foreach ($home->getChildren() as $child) {
            $names[] = $child->getName();
            if ($child->getName() === CalendarCollectionUris::SCHEDULE_INBOX) {
                $inboxNamed[] = $child;
            }
        }

        $this->assertCount(1, $inboxNamed);
        $this->assertInstanceOf(Inbox::class, $inboxNamed[0]);
        $this->assertInstanceOf(Inbox::class, $home->getChild(CalendarCollectionUris::SCHEDULE_INBOX));
        $this->assertContains(InboxTaskListProvisioner::URI, $names);
        $this->assertNotContains(InboxTaskListProvisioner::LEGACY_URI, array_values(array_filter(
            $names,
            static fn (string $name): bool => $name !== CalendarCollectionUris::SCHEDULE_INBOX,
        )));
        $this->assertNotSame(CalendarCollectionUris::SCHEDULE_INBOX, InboxTaskListProvisioner::URI);
    }

    public function test_propfind_calendar_home_lists_one_inbox_href(): void
    {
        $installRoot = sys_get_temp_dir().'/wgw-cal-inbox-'.uniqid('', true);
        mkdir($installRoot, 0775, true);
        file_put_contents($installRoot.'/index.php', "<?php\n");
        $dataDir = $installRoot.'/wgw-content';
        mkdir($dataDir, 0775, true);
        WgwInstallFixture::bindInstallRoot($installRoot, $dataDir);
        WgwInstallFixture::markInstalled($installRoot, $dataDir, 'bob');
        config(['wgw.install_root' => $installRoot, 'wgw.data_dir' => $dataDir]);
        WgwInstallFixture::forgetInstallBindings();

        $auth = 'Basic '.base64_encode('bob:secret');
        $response = $this->call('PROPFIND', '/calendars/bob', [], [], [], [
            'HTTP_AUTHORIZATION' => $auth,
            'HTTP_DEPTH' => '1',
            'HTTP_ACCEPT' => '*/*',
            'CONTENT_TYPE' => 'application/xml',
        ], '<?xml version="1.0" encoding="utf-8"?>'
            .'<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">'
            .'<d:prop><d:resourcetype/></d:prop>'
            .'</d:propfind>');

        $response->assertStatus(207);
        $xml = $response->getContent();
        $this->assertIsString($xml);

        preg_match_all('#<[^>]*href[^>]*>\s*([^<]+)\s*</[^>]*href>#i', $xml, $matches);
        $hrefs = $matches[1] ?? [];
        $inboxHrefs = array_values(array_filter(
            $hrefs,
            static fn (string $href): bool => (bool) preg_match('#/calendars/bob/inbox/?$#', rtrim($href)),
        ));
        $this->assertCount(1, $inboxHrefs, 'calendar-home must list exactly one child named inbox');
        $this->assertStringContainsString('schedule-inbox', $xml);
    }
}
