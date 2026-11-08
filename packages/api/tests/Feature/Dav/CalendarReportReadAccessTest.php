<?php

declare(strict_types=1);

namespace Tests\Feature\Dav;

use App\Dav\SabreServerFactory;
use App\Dav\Server\AppScheduleInbox;
use App\Dav\Server\AppSharedCalendar;
use App\Models\CalendarInstance;
use App\Models\Principal;
use App\Services\Admin\AdminConstants;
use App\Services\Calendars\UserCalendarCollectionsProvisioner;
use App\Support\WgwSettings;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\DataProvider;
use Sabre\CalDAV\Backend\PDO as CalPDO;
use Sabre\CalDAV\Xml\Property\SupportedCalendarComponentSet;
use Sabre\DAV\Sharing\Plugin as SharingPlugin;
use Sabre\DAV\Xml\Element\Sharee;
use Tests\Support\WgwDatabaseTestCase;
use Tests\Support\WgwInstallFixture;
use Tests\Support\WgwTestDisks;

/**
 * Calendar REPORTs need {DAV:}read on the target collection.
 *
 * Callers: owner (alice), read sharee (bob), shared-Team colleague (carol), outsider
 * (dave), admin (root). Colleagues see availability only through the scheduling
 * outbox, which applies the Team availability rules; never through these REPORTs.
 */
final class CalendarReportReadAccessTest extends WgwDatabaseTestCase
{
    private const EVENT_URI = 'roadmap-review-43a7d6a9.ics';

    private const CALDAV = 'xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"';

    protected function setUp(): void
    {
        parent::setUp();

        $installRoot = sys_get_temp_dir().'/wgw-dav-report-root-'.uniqid('', true);
        mkdir($installRoot, 0775, true);
        file_put_contents($installRoot.'/index.php', "<?php\n");
        $dataDir = $installRoot.'/wgw-content';
        mkdir($dataDir.'/files/users', 0775, true);
        mkdir($dataDir.'/files/groups', 0775, true);
        WgwInstallFixture::bindInstallRoot($installRoot, $dataDir);
        WgwInstallFixture::markInstalled($installRoot, $dataDir, 'alice');

        config(['wgw.install_root' => $installRoot, 'wgw.data_dir' => $dataDir]);
        WgwInstallFixture::forgetInstallBindings();
        WgwInstallFixture::purgeDatabaseConnection();
        $this->setAppSetting(WgwSettings::BROWSER_PLUGIN, false);
        $this->setAppSetting(WgwSettings::CALENDAR_ENABLED, true);
        WgwTestDisks::refresh($dataDir);
        Mail::fake();

        // markInstalled seeds alice without an address; scheduling needs one.
        Principal::query()->where('uri', 'principals/alice')->update(['email' => 'alice@example.test']);
        $this->seedWgwUser('bob', email: 'bob@example.test', displayName: 'Bob');
        $this->seedWgwUser('carol', email: 'carol@example.test', displayName: 'Carol');
        $this->seedWgwUser('dave', email: 'dave@example.test', displayName: 'Dave');
        $this->seedWgwUser('root', email: 'root@example.test', displayName: 'Root');
        $this->seedSharedTeam('eng', 'alice', 'bob', 'carol');
        $admins = Principal::query()->where('uri', AdminConstants::ADMIN_GROUP_URI)->first()
            ?? $this->seedWgwGroup(AdminConstants::ADMIN_GROUP_URI, 'Administrators');
        $root = Principal::forUsername('root');
        $this->assertNotNull($root);
        $this->addPrincipalToGroup($admins, $root);

        $calendarId = $this->seedCalendar('alice', 'default');
        $caldav = new CalPDO(DB::connection('wgw')->getPdo());
        $caldav->createCalendarObject($calendarId, self::EVENT_URI, $this->eventIcs('roadmap-1', 'Roadmap review', '20261120T100000Z'));
        $caldav->updateInvites($calendarId, [
            new Sharee([
                'href' => 'mailto:bob@example.test',
                'principal' => 'principals/bob',
                'access' => SharingPlugin::ACCESS_READ,
                'properties' => ['{DAV:}displayname' => 'Alice (shared)'],
            ]),
        ]);
    }

    /**
     * @return array<string, array{0: string}>
     */
    public static function reports(): array
    {
        return [
            'free-busy-query' => ['free-busy-query'],
            'calendar-query' => ['calendar-query'],
            'calendar-query with time-range' => ['calendar-query-range'],
            'calendar-multiget' => ['calendar-multiget'],
            'sync-collection' => ['sync-collection'],
            'expand-property' => ['expand-property'],
        ];
    }

    /**
     * @return array<string, array{0: string, 1: string}>
     */
    public static function nonReadersByReport(): array
    {
        $cases = [];
        foreach (['bob' => 'read sharee on the owner path', 'carol' => 'shared-Team colleague', 'dave' => 'outsider', 'root' => 'admin'] as $user => $role) {
            foreach (array_keys(self::reports()) as $report) {
                $cases[$role.' / '.$report] = [$user, self::reports()[$report][0]];
            }
        }

        return $cases;
    }

    #[DataProvider('reports')]
    public function test_owner_can_run_the_report(string $report): void
    {
        $response = $this->report('alice', '/calendars/alice/default/', $report);

        $this->assertReportAnswered($response, $report, '/calendars/alice/default/');
    }

    #[DataProvider('reports')]
    public function test_read_sharee_can_run_the_report_on_their_copy(string $report): void
    {
        $sharedUri = CalendarInstance::query()->where('principaluri', 'principals/bob')->value('uri');
        $this->assertIsString($sharedUri);
        $path = '/calendars/bob/'.$sharedUri.'/';

        $response = $this->report('bob', $path, $report);

        $this->assertReportAnswered($response, $report, $path);
    }

    #[DataProvider('nonReadersByReport')]
    public function test_caller_without_read_is_refused_before_listing(string $user, string $report): void
    {
        $response = $this->report($user, '/calendars/alice/default/', $report);

        $response->assertForbidden();
        $body = (string) $response->getContent();
        $this->assertStringNotContainsString('roadmap-review', $body);
        $this->assertStringNotContainsString('FREEBUSY', $body);
    }

    public function test_calendars_drop_the_free_busy_grant_to_every_signed_in_user(): void
    {
        $backend = new CalPDO(DB::connection('wgw')->getPdo());
        foreach ([SharingPlugin::ACCESS_SHAREDOWNER, SharingPlugin::ACCESS_READ, SharingPlugin::ACCESS_READWRITE] as $access) {
            $calendar = new AppSharedCalendar($backend, [
                'id' => [1, 1],
                'uri' => 'default',
                'principaluri' => 'principals/alice',
                'share-access' => $access,
            ]);
            $acl = $calendar->getACL();

            foreach ($acl as $ace) {
                $this->assertNotSame('{DAV:}authenticated', $ace['principal'], 'access '.$access);
            }
            $this->assertContains(
                ['privilege' => '{DAV:}read', 'principal' => 'principals/alice', 'protected' => true],
                $acl,
            );
        }
    }

    public function test_owner_keeps_incremental_sync_and_multiget(): void
    {
        $first = $this->report('alice', '/calendars/alice/default/', 'sync-collection');
        $first->assertStatus(207);
        $this->assertSame(1, preg_match('#<d:sync-token>([^<]+)</d:sync-token>#', (string) $first->getContent(), $token));

        $this->dav('PUT', '/calendars/alice/default/added.ics', 'alice', $this->eventIcs('added-1', 'Added later', '20261121T100000Z'), [
            'CONTENT_TYPE' => 'text/calendar',
        ])->assertCreated();

        $delta = $this->dav('REPORT', '/calendars/alice/default/', 'alice', '<d:sync-collection '.self::CALDAV.'>'
            .'<d:sync-token>'.$token[1].'</d:sync-token><d:sync-level>1</d:sync-level>'
            .'<d:prop><d:getetag/></d:prop></d:sync-collection>', depth: '0');
        $delta->assertStatus(207);
        $this->assertStringContainsString('/calendars/alice/default/added.ics', (string) $delta->getContent());
        $this->assertStringNotContainsString(self::EVENT_URI, (string) $delta->getContent());

        $multiget = $this->dav('REPORT', '/calendars/alice/default/', 'alice', '<c:calendar-multiget '.self::CALDAV.'>'
            .'<d:prop><d:getetag/><c:calendar-data/></d:prop>'
            .'<d:href>/calendars/alice/default/added.ics</d:href></c:calendar-multiget>', depth: '1');
        $multiget->assertStatus(207);
        $this->assertStringContainsString('SUMMARY:Added later', (string) $multiget->getContent());
    }

    public function test_inbox_is_private_to_its_owner_and_delivery_still_works(): void
    {
        $this->seedCalendar('carol', 'default');
        $invite = implode("\r\n", [
            'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//WGW//Test//EN', 'BEGIN:VEVENT',
            'UID:invite-1', 'DTSTAMP:20261108T120000Z', 'DTSTART:20261122T100000Z', 'DTEND:20261122T110000Z',
            'SUMMARY:Pending invite', 'ORGANIZER:mailto:carol@example.test',
            'ATTENDEE;PARTSTAT=ACCEPTED:mailto:carol@example.test', 'ATTENDEE;RSVP=TRUE:mailto:alice@example.test',
            'END:VEVENT', 'END:VCALENDAR', '',
        ]);
        $this->dav('PUT', '/calendars/carol/default/invite-1.ics', 'carol', $invite, [
            'CONTENT_TYPE' => 'text/calendar',
        ])->assertCreated();

        $ownerListing = $this->dav('PROPFIND', '/calendars/alice/inbox/', 'alice', '<d:propfind '.self::CALDAV.'><d:prop><d:getetag/></d:prop></d:propfind>', depth: '1');
        $ownerListing->assertStatus(207);
        $this->assertSame(1, preg_match_all('#/calendars/alice/inbox/[^<]+\.ics#', (string) $ownerListing->getContent()));
        $this->assertInstanceOf(AppScheduleInbox::class, $this->treeNode('calendars/alice/inbox'));

        foreach (['bob', 'carol', 'dave', 'root'] as $user) {
            $this->dav('PROPFIND', '/calendars/alice/inbox/', $user, '<d:propfind '.self::CALDAV.'><d:prop><d:getetag/></d:prop></d:propfind>', depth: '1')
                ->assertForbidden();
            $this->dav('REPORT', '/calendars/alice/inbox/', $user, '<c:calendar-query '.self::CALDAV.'><d:prop><d:getetag/></d:prop>'
                .'<c:filter><c:comp-filter name="VCALENDAR"/></c:filter></c:calendar-query>', depth: '1')
                ->assertForbidden();
        }
    }

    public function test_principal_lookups_keep_working(): void
    {
        $search = $this->dav('REPORT', '/principals/', 'carol', '<d:principal-property-search xmlns:d="DAV:">'
            .'<d:property-search><d:prop><d:displayname/></d:prop><d:match>carol</d:match></d:property-search>'
            .'<d:prop><d:displayname/></d:prop></d:principal-property-search>', depth: '0');
        $search->assertStatus(207);
        // Directory search returns only the caller; the REPORT still has to answer.
        $this->assertStringContainsString('/principals/carol/', (string) $search->getContent());

        foreach (['alice' => '/principals/alice/', 'carol' => '/principals/alice/'] as $user => $path) {
            $this->dav('REPORT', $path, $user, '<d:expand-property xmlns:d="DAV:" xmlns:cs="http://calendarserver.org/ns/">'
                .'<d:property name="calendar-proxy-write-for" namespace="http://calendarserver.org/ns/">'
                .'<d:property name="displayname"/></d:property></d:expand-property>', depth: '0')
                ->assertStatus(207);
        }
    }

    public function test_team_calendars_are_not_served_over_caldav(): void
    {
        app(UserCalendarCollectionsProvisioner::class)->ensureForGroupPrincipal('principals/groups/eng', 'Eng');

        foreach (['alice', 'dave'] as $user) {
            $this->report($user, '/calendars/groups/eng/', 'calendar-query')->assertNotFound();
        }
    }

    private function assertReportAnswered(TestResponse $response, string $report, string $path): void
    {
        $body = (string) $response->getContent();
        if ($report === 'free-busy-query') {
            $response->assertOk();
            $this->assertStringContainsString('FREEBUSY:20261120T100000Z/20261120T110000Z', $body);

            return;
        }
        $response->assertStatus(207);
        $this->assertStringContainsString($path.self::EVENT_URI, $body);
    }

    private function report(string $user, string $path, string $report): TestResponse
    {
        $range = '<c:time-range start="20261101T000000Z" end="20261201T000000Z"/>';
        [$depth, $body] = match ($report) {
            'free-busy-query' => ['1', '<c:free-busy-query '.self::CALDAV.'>'.$range.'</c:free-busy-query>'],
            'calendar-query' => ['1', '<c:calendar-query '.self::CALDAV.'><d:prop><d:getetag/></d:prop>'
                .'<c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"/></c:comp-filter></c:filter></c:calendar-query>'],
            'calendar-query-range' => ['1', '<c:calendar-query '.self::CALDAV.'><d:prop><d:getetag/></d:prop>'
                .'<c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT">'.$range.'</c:comp-filter></c:comp-filter></c:filter></c:calendar-query>'],
            'calendar-multiget' => ['1', '<c:calendar-multiget '.self::CALDAV.'><d:prop><d:getetag/></d:prop>'
                .'<d:href>'.$path.self::EVENT_URI.'</d:href></c:calendar-multiget>'],
            'sync-collection' => ['0', '<d:sync-collection '.self::CALDAV.'><d:sync-token/><d:sync-level>1</d:sync-level>'
                .'<d:prop><d:getetag/></d:prop></d:sync-collection>'],
            'expand-property' => ['1', '<d:expand-property '.self::CALDAV.'><d:property name="displayname"/></d:expand-property>'],
        };

        return $this->dav('REPORT', $path, $user, $body, depth: $depth);
    }

    /**
     * @param  array<string, string>  $server
     */
    private function dav(string $method, string $path, string $username, ?string $body = null, array $server = [], ?string $depth = null): TestResponse
    {
        $server['HTTP_AUTHORIZATION'] = 'Basic '.base64_encode($username.':secret');
        $server['CONTENT_TYPE'] ??= 'application/xml';
        if ($depth !== null) {
            $server['HTTP_DEPTH'] = $depth;
        }
        // PUT/POST/PATCH bodies are forwarded without Content-Length
        // (SabreHttpRequestFactory). Other methods drop the body unless it is set.
        if ($body !== null && ! in_array($method, ['PUT', 'POST', 'PATCH'], true)) {
            $server['CONTENT_LENGTH'] = (string) strlen($body);
        }

        return $this->call($method, $path, [], [], [], $server, $body);
    }

    private function treeNode(string $path): object
    {
        return app(SabreServerFactory::class)->create()->tree->getNodeForPath($path);
    }

    /**
     * @return array{0: int, 1: int}
     */
    private function seedCalendar(string $username, string $uri): array
    {
        $caldav = new CalPDO(DB::connection('wgw')->getPdo());
        $caldav->createCalendar('principals/'.$username, $uri, [
            '{DAV:}displayname' => 'Calendar',
            '{urn:ietf:params:xml:ns:caldav}supported-calendar-component-set' => new SupportedCalendarComponentSet(['VEVENT']),
        ]);
        foreach ($caldav->getCalendarsForUser('principals/'.$username) as $calendar) {
            if (($calendar['uri'] ?? '') === $uri) {
                return [(int) $calendar['id'][0], (int) $calendar['id'][1]];
            }
        }
        $this->fail('Calendar not created: '.$username.'/'.$uri);
    }

    private function eventIcs(string $uid, string $summary, string $start): string
    {
        $end = substr_replace($start, '11', 9, 2);

        return implode("\r\n", [
            'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//WGW//Test//EN', 'BEGIN:VEVENT',
            'UID:'.$uid, 'DTSTAMP:20261108T120000Z', 'DTSTART:'.$start, 'DTEND:'.$end,
            'SUMMARY:'.$summary, 'END:VEVENT', 'END:VCALENDAR', '',
        ]);
    }
}
