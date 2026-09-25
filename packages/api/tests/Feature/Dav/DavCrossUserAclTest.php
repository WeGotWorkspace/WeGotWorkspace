<?php

declare(strict_types=1);

namespace Tests\Feature\Dav;

use App\Models\CalendarInstance;
use App\Models\CalendarObject;
use App\Models\Principal;
use App\Services\Admin\AdminConstants;
use App\Support\WgwSettings;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Testing\TestResponse;
use Sabre\CalDAV\Backend\PDO as CalPDO;
use Sabre\CalDAV\Xml\Property\SupportedCalendarComponentSet;
use Sabre\DAV\Sharing\Plugin as SharingPlugin;
use Sabre\DAV\Xml\Element\Sharee;
use Tests\Support\WgwDatabaseTestCase;
use Tests\Support\WgwInstallFixture;
use Tests\Support\WgwTestDisks;

/**
 * Cross-user denial for the DAV glue Apple Calendar and Finder hit:
 * principal/path mapping on file homes, calendar ACL, and group-member grants.
 *
 * Status only, plus proof a denied PUT does not write. Not a Sabre semantics suite.
 */
final class DavCrossUserAclTest extends WgwDatabaseTestCase
{
    private const ALICE_FILE = 'users/alice/secret.txt';

    private const ALICE_FILE_BODY = 'alice-secret-body';

    private const ALICE_EVENT_URI = 'alice-owned.ics';

    protected function setUp(): void
    {
        parent::setUp();

        $installRoot = sys_get_temp_dir().'/wgw-dav-acl-root-'.uniqid('', true);
        mkdir($installRoot, 0775, true);
        file_put_contents($installRoot.'/index.php', "<?php\n");
        $dataDir = $installRoot.'/wgw-content';
        mkdir($dataDir.'/files/users/alice', 0775, true);
        mkdir($dataDir.'/files/groups', 0775, true);
        WgwInstallFixture::bindInstallRoot($installRoot, $dataDir);
        WgwInstallFixture::markInstalled($installRoot, $dataDir, 'alice');

        config(['wgw.install_root' => $installRoot, 'wgw.data_dir' => $dataDir]);
        WgwInstallFixture::forgetInstallBindings();
        WgwInstallFixture::purgeDatabaseConnection();
        $this->setAppSetting(WgwSettings::BROWSER_PLUGIN, false);
        WgwTestDisks::refresh($dataDir);

        $this->seedWgwUser('bob', email: 'bob@example.test', displayName: 'Bob');
    }

    public function test_cross_user_file_methods_are_denied(): void
    {
        Storage::disk('wgw_files')->put(self::ALICE_FILE, self::ALICE_FILE_BODY);

        $this->dav('GET', '/files/users/alice/secret.txt', username: 'bob')->assertNotFound();
        $this->dav('PUT', '/files/users/alice/secret.txt', 'bob-overwrite', [
            'CONTENT_TYPE' => 'text/plain',
        ], username: 'bob')->assertNotFound();
        $this->dav('PROPFIND', '/files/users/alice/secret.txt', depth: '0', username: 'bob')->assertNotFound();
        $this->dav('PUT', '/files/users/alice/bob-planted.txt', 'bob-create', [
            'CONTENT_TYPE' => 'text/plain',
        ], username: 'bob')->assertNotFound();

        $owned = $this->dav('GET', '/files/users/alice/secret.txt');
        $owned->assertOk();
        $this->assertSame(self::ALICE_FILE_BODY, $owned->streamedContent());
        $this->assertFalse(Storage::disk('wgw_files')->exists('users/alice/bob-planted.txt'));
        $this->dav('GET', '/files/users/alice/bob-planted.txt')->assertNotFound();
    }

    public function test_cross_user_calendar_methods_are_denied(): void
    {
        $this->seedAliceEvent();
        $before = $this->calendarBlob(self::ALICE_EVENT_URI);

        // 403 is the current calendar behavior. The home still resolves for iTIP, unlike
        // file homes, which hide the path with 404. GET and PUT fail Sabre's read/write
        // check. PROPFIND is rejected first: Sabre would otherwise answer HTTP 207 with
        // a per-property 403.
        $this->dav('GET', '/calendars/alice/default/'.self::ALICE_EVENT_URI, username: 'bob')->assertForbidden();
        $this->dav(
            'PUT',
            '/calendars/alice/default/'.self::ALICE_EVENT_URI,
            $this->eventIcs('bob-overwrite', 'Bob Overwrite'),
            ['CONTENT_TYPE' => 'text/calendar'],
            username: 'bob',
        )->assertForbidden();
        $this->dav('PROPFIND', '/calendars/alice/default/', depth: '0', username: 'bob')->assertForbidden();
        $this->dav(
            'PUT',
            '/calendars/alice/default/bob-planted.ics',
            $this->eventIcs('bob-planted', 'Bob Planted'),
            ['CONTENT_TYPE' => 'text/calendar'],
            username: 'bob',
        )->assertForbidden();

        $this->assertSame($before, $this->calendarBlob(self::ALICE_EVENT_URI));
        $this->assertNull(CalendarObject::query()->where('uri', 'bob-planted.ics')->first());

        $this->dav('PROPFIND', '/calendars/alice/', depth: '0')->assertStatus(207);
        $this->dav('PROPFIND', '/calendars/alice/default/', depth: '0')->assertStatus(207);

        $owned = $this->dav('GET', '/calendars/alice/default/'.self::ALICE_EVENT_URI);
        $owned->assertOk();
        $this->assertStringContainsString('Alice Owned', $owned->streamedContent());
    }

    public function test_group_member_can_write_and_outsider_is_denied(): void
    {
        Principal::query()->firstOrCreate(
            ['uri' => AdminConstants::GROUP_CONTAINER_URI],
            ['displayname' => 'Groups', 'email' => null],
        );
        $team = $this->seedWgwGroup('principals/groups/team', 'Team');
        $alice = Principal::forUsername('alice');
        $this->assertNotNull($alice);
        $this->addPrincipalToGroup($team, $alice);

        $this->dav('PUT', '/files/groups/team/note.txt', 'member-create', [
            'CONTENT_TYPE' => 'text/plain',
        ])->assertCreated();
        $this->dav('PUT', '/files/groups/team/note.txt', 'member-overwrite', [
            'CONTENT_TYPE' => 'text/plain',
        ])->assertNoContent();

        $owned = $this->dav('GET', '/files/groups/team/note.txt');
        $owned->assertOk();
        $this->assertSame('member-overwrite', $owned->streamedContent());

        $this->dav('GET', '/files/groups/team/note.txt', username: 'bob')->assertNotFound();
        $this->dav('PUT', '/files/groups/team/note.txt', 'outsider-overwrite', [
            'CONTENT_TYPE' => 'text/plain',
        ], username: 'bob')->assertNotFound();
        $this->dav('PROPFIND', '/files/groups/team/note.txt', depth: '0', username: 'bob')->assertNotFound();

        $still = $this->dav('GET', '/files/groups/team/note.txt');
        $still->assertOk();
        $this->assertSame('member-overwrite', $still->streamedContent());
    }

    public function test_sharee_propfind_on_shared_calendar_is_allowed(): void
    {
        $calendarId = $this->seedAliceEvent();
        $caldav = new CalPDO(DB::connection('wgw')->getPdo());
        $caldav->updateInvites($calendarId, [
            new Sharee([
                'href' => 'mailto:bob@example.test',
                'principal' => 'principals/bob',
                'access' => SharingPlugin::ACCESS_READ,
                'properties' => ['{DAV:}displayname' => 'Bob'],
            ]),
        ]);

        $sharedUri = CalendarInstance::query()
            ->where('principaluri', 'principals/bob')
            ->value('uri');
        $this->assertIsString($sharedUri);
        $this->assertNotSame('', $sharedUri);

        $this->dav('PROPFIND', '/calendars/bob/'.$sharedUri.'/', depth: '0', username: 'bob')
            ->assertStatus(207);
    }

    public function test_authenticated_user_can_propfind_own_file_home(): void
    {
        $this->dav('PROPFIND', '/files/users/bob', depth: '0', username: 'bob')->assertStatus(207);
    }

    /**
     * @param  array<string, string>  $server
     */
    private function dav(
        string $method,
        string $path,
        ?string $body = null,
        array $server = [],
        ?string $depth = null,
        string $username = 'alice',
    ): TestResponse {
        $server['HTTP_AUTHORIZATION'] = 'Basic '.base64_encode($username.':secret');
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

    /**
     * @return array{0: int, 1: int}
     */
    private function seedAliceEvent(): array
    {
        $caldav = new CalPDO(DB::connection('wgw')->getPdo());
        $caldav->createCalendar('principals/alice', 'default', [
            '{DAV:}displayname' => 'Calendar',
            '{urn:ietf:params:xml:ns:caldav}supported-calendar-component-set' => new SupportedCalendarComponentSet(['VEVENT']),
        ]);

        $calendarId = null;
        foreach ($caldav->getCalendarsForUser('principals/alice') as $calendar) {
            if (($calendar['uri'] ?? '') === 'default') {
                $calendarId = $calendar['id'];
            }
        }
        $this->assertIsArray($calendarId);

        $id = [(int) $calendarId[0], (int) $calendarId[1]];
        $caldav->createCalendarObject(
            $id,
            self::ALICE_EVENT_URI,
            $this->eventIcs('alice-owned', 'Alice Owned'),
        );

        return $id;
    }

    private function calendarBlob(string $uri): string
    {
        $stored = CalendarObject::query()->where('uri', $uri)->first();
        $this->assertNotNull($stored);
        $data = $stored->calendardata;

        return is_string($data) ? $data : (string) $data;
    }

    private function eventIcs(string $uid, string $summary): string
    {
        return implode("\r\n", [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'PRODID:-//WGW//Test//EN',
            'BEGIN:VEVENT',
            'UID:'.$uid,
            'DTSTAMP:20260924T120000Z',
            'DTSTART:20260925T100000Z',
            'DTEND:20260925T110000Z',
            'SUMMARY:'.$summary,
            'END:VEVENT',
            'END:VCALENDAR',
            '',
        ]);
    }
}
