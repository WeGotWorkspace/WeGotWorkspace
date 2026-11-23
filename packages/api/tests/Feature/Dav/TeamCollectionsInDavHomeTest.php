<?php

declare(strict_types=1);

namespace Tests\Feature\Dav;

use App\Dav\SabreServerFactory;
use App\Dav\Server\WgwCalendarBackendFactory;
use App\Models\GroupMember;
use App\Models\Principal;
use App\Services\Calendars\CollectionKind;
use App\Services\Calendars\UserCalendarCollectionsProvisioner;
use App\Services\Contacts\AddressBookProvisioner;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Mail;
use Sabre\CalDAV\Xml\Property\SupportedCalendarComponentSet;
use Sabre\DAV\Exception as SabreDavException;
use Sabre\DAV\Sharing\Plugin as SharingPlugin;
use Sabre\DAV\Xml\Element\Sharee;
use Sabre\HTTP\Request as SabreRequest;
use Sabre\HTTP\Response as SabreResponse;
use Tests\Support\CalendarsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Team calendars, task lists and address books show up in each member's own
 * CalDAV and CardDAV home, the only place native apps look (#2158).
 *
 * bob and dave are in Team t1. carol is in Team t2.
 */
final class TeamCollectionsInDavHomeTest extends WgwDatabaseTestCase
{
    use CalendarsTestFixtures;

    private ?string $sabreDataDir = null;

    protected function calendarFixtureUsersShareATeam(): bool
    {
        return false;
    }

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpCalendarsFixtures();
        $this->seedWgwUser('dave', displayName: 'Dave');
        foreach (['bob', 'carol', 'dave'] as $username) {
            $this->seedDefaultCalendarFor($username);
        }
        $this->putInTeam('t1', ['bob', 'dave']);
        $this->putInTeam('t2', ['carol']);
        app(UserCalendarCollectionsProvisioner::class)->ensureForGroupPrincipal('principals/groups/t1', 'T1');
        app(UserCalendarCollectionsProvisioner::class)->ensureForGroupPrincipal('principals/groups/t2', 'T2');
        app(AddressBookProvisioner::class)->ensureForGroupPrincipal('principals/groups/t1', 'T1');
        Mail::fake();
    }

    protected function tearDown(): void
    {
        if ($this->sabreDataDir !== null) {
            File::deleteDirectory($this->sabreDataDir);
            $this->sabreDataDir = null;
        }
        parent::tearDown();
    }

    public function test_a_member_finds_the_collections_of_their_own_teams_in_their_calendar_home(): void
    {
        $listed = $this->homeChildren('bob', '/calendars/bob/');

        $this->assertContains('default', $listed);
        $this->assertContains('team~t1~t1', $listed);
        $this->assertContains('team~t1~tasks-t1', $listed);
        $this->assertNotContains('team~t2~t2', $listed);
        $this->assertSame([], array_values(array_filter($listed, static fn (string $n): bool => str_contains($n, 't2'))));
    }

    public function test_api_only_team_collections_stay_out_of_the_home(): void
    {
        app(WgwCalendarBackendFactory::class)->make()
            ->createCollection(CollectionKind::ChatChannel, 'principals/groups/t1', 'chat-t1', [
                '{DAV:}displayname' => 'Chat',
                '{urn:ietf:params:xml:ns:caldav}supported-calendar-component-set' => new SupportedCalendarComponentSet(['VJOURNAL']),
            ]);

        $this->assertNotContains('team~t1~chat-t1', $this->homeChildren('bob', '/calendars/bob/'));
        $this->assertSame(404, $this->sabre('bob', 'PROPFIND', '/calendars/bob/team~t1~chat-t1/', $this->propBody('<d:displayname/>'), ['Depth' => '0'])['status']);
    }

    public function test_an_event_one_member_adds_reaches_the_other_member_and_the_team_calendar(): void
    {
        $put = $this->sabre('bob', 'PUT', '/calendars/bob/team~t1~t1/standup.ics', $this->eventIcs('standup-1'), ['Content-Type' => 'text/calendar']);
        $this->assertContains($put['status'], [201, 204], $put['body']);

        $get = $this->sabre('dave', 'GET', '/calendars/dave/team~t1~t1/standup.ics', '');
        $this->assertSame(200, $get['status'], $get['body']);
        $this->assertStringContainsString('UID:standup-1', $get['body']);

        $stored = DB::connection('wgw')->table('calendarobjects')
            ->join('calendarinstances', 'calendarinstances.calendarid', '=', 'calendarobjects.calendarid')
            ->where('calendarinstances.principaluri', 'principals/groups/t1')
            ->where('calendarinstances.uri', 't1')
            ->where('calendarobjects.uri', 'standup.ics')
            ->exists();
        $this->assertTrue($stored);

        $update = $this->sabre('dave', 'PUT', '/calendars/dave/team~t1~t1/standup.ics', $this->eventIcs('standup-1', 'Moved standup'), ['Content-Type' => 'text/calendar']);
        $this->assertSame(204, $update['status'], $update['body']);
        $this->assertSame(204, $this->sabre('dave', 'DELETE', '/calendars/dave/team~t1~t1/standup.ics', '')['status']);
    }

    public function test_someone_outside_the_team_cannot_reach_its_collections(): void
    {
        $this->assertSame(404, $this->sabre('carol', 'PROPFIND', '/calendars/carol/team~t1~t1/', $this->propBody('<d:displayname/>'), ['Depth' => '0'])['status']);
        $this->assertSame(404, $this->sabre('carol', 'PUT', '/calendars/carol/team~t1~t1/x.ics', $this->eventIcs('x-1'), ['Content-Type' => 'text/calendar'])['status']);
        $this->assertNotSame(207, $this->sabre('carol', 'PROPFIND', '/calendars/bob/team~t1~t1/', $this->propBody('<d:displayname/>'), ['Depth' => '0'])['status']);
    }

    public function test_an_invitation_saved_in_a_team_calendar_goes_out_as_the_member(): void
    {
        $uid = 'team-invite-'.uniqid();
        $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//WGW//Test//EN\r\n"
            ."BEGIN:VEVENT\r\nUID:{$uid}\r\nDTSTAMP:20300101T000000Z\r\nSEQUENCE:0\r\nSUMMARY:Planning\r\n"
            ."DTSTART:20300304T100000Z\r\nDTEND:20300304T110000Z\r\n"
            ."ORGANIZER:mailto:bob@example.test\r\n"
            ."ATTENDEE;PARTSTAT=ACCEPTED:mailto:bob@example.test\r\n"
            ."ATTENDEE;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:dave@example.test\r\n"
            ."END:VEVENT\r\nEND:VCALENDAR\r\n";

        $put = $this->sabre('bob', 'PUT', '/calendars/bob/team~t1~t1/planning.ics', $ics, ['Content-Type' => 'text/calendar']);
        $this->assertContains($put['status'], [201, 204], $put['body']);

        $delivered = DB::connection('wgw')->table('calendarobjects')
            ->join('calendarinstances', 'calendarinstances.calendarid', '=', 'calendarobjects.calendarid')
            ->where('calendarinstances.principaluri', 'principals/dave')
            ->where('calendarobjects.uid', $uid)
            ->exists();
        $this->assertTrue($delivered, 'dave got the invitation in his own calendar');

        $delete = $this->sabre('bob', 'DELETE', '/calendars/bob/team~t1~t1/planning.ics', '');
        $this->assertContains($delete['status'], [200, 204], $delete['body']);

        $copy = DB::connection('wgw')->table('calendarobjects')
            ->join('calendarinstances', 'calendarinstances.calendarid', '=', 'calendarobjects.calendarid')
            ->where('calendarinstances.principaluri', 'principals/dave')
            ->where('calendarobjects.uid', $uid)
            ->value('calendarobjects.calendardata');
        $this->assertStringContainsString('STATUS:CANCELLED', (string) $copy, 'dave got the cancellation');
    }

    public function test_a_team_mate_cannot_reach_a_team_calendar_through_another_members_home(): void
    {
        $this->assertSame(404, $this->sabre('dave', 'PROPFIND', '/calendars/bob/team~t1~t1/', $this->propBody('<d:displayname/>'), ['Depth' => '0'])['status']);
        $this->assertSame(404, $this->sabre('dave', 'PUT', '/calendars/bob/team~t1~t1/spoof.ics', $this->eventIcs('spoof-1'), ['Content-Type' => 'text/calendar'])['status']);
    }

    public function test_leaving_the_team_removes_its_collections_from_the_home(): void
    {
        $team = Principal::query()->where('uri', 'principals/groups/t1')->firstOrFail();
        $dave = Principal::forUsername('dave');
        $this->assertNotNull($dave);
        GroupMember::query()->where('principal_id', $team->id)->where('member_id', $dave->id)->delete();

        $this->assertNotContains('team~t1~t1', $this->homeChildren('dave', '/calendars/dave/'));
        $this->assertSame(404, $this->sabre('dave', 'GET', '/calendars/dave/team~t1~t1/', '')['status']);
    }

    public function test_a_team_calendar_cannot_be_deleted_from_a_calendar_app(): void
    {
        $this->assertSame(403, $this->sabre('bob', 'DELETE', '/calendars/bob/team~t1~t1/', '')['status']);
        $this->assertTrue(DB::connection('wgw')->table('calendarinstances')
            ->where('principaluri', 'principals/groups/t1')->where('uri', 't1')->exists());
    }

    public function test_a_members_own_calendar_cannot_take_a_team_name(): void
    {
        $body = '<?xml version="1.0"?><c:mkcalendar xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:set><d:prop><d:displayname>Mine</d:displayname></d:prop></d:set></c:mkcalendar>';

        $this->assertSame(403, $this->sabre('bob', 'MKCALENDAR', '/calendars/bob/team~t9~mine/', $body, ['Content-Type' => 'application/xml'])['status']);
    }

    public function test_a_team_calendar_is_never_the_default_for_invitations_and_cannot_be_shared_on(): void
    {
        $result = $this->sabre('bob', 'PROPFIND', '/principals/bob/', $this->propBody('<c:schedule-default-calendar-URL/>'), ['Depth' => '0']);
        $this->assertSame(207, $result['status'], $result['body']);
        $this->assertStringContainsString('/calendars/bob/default/', $result['body']);

        $privileges = $this->sabre('bob', 'PROPFIND', '/calendars/bob/team~t1~t1/', $this->propBody('<d:current-user-privilege-set/>'), ['Depth' => '0']);
        $this->assertSame(207, $privileges['status'], $privileges['body']);
        $this->assertStringContainsString('<d:write/>', $privileges['body']);
        $this->assertStringNotContainsString('<d:share/>', $privileges['body']);
    }

    public function test_a_calendar_shared_read_only_with_the_team_stays_read_only_for_members(): void
    {
        $backend = app(WgwCalendarBackendFactory::class)->make();
        $own = collect($backend->getCalendarsForUser('principals/dave'))->firstWhere('uri', 'default');
        $this->assertIsArray($own);
        $backend->updateInvites($own['id'], [new Sharee([
            'href' => 'principals/groups/t1',
            'principal' => 'principals/groups/t1',
            'access' => SharingPlugin::ACCESS_READ,
            'inviteStatus' => SharingPlugin::INVITE_ACCEPTED,
        ])]);
        $shared = collect($backend->getCalendarsForUser('principals/groups/t1'))
            ->first(static fn (array $c): bool => (int) ($c['share-access'] ?? 0) === SharingPlugin::ACCESS_READ);
        $this->assertIsArray($shared, 'the share reached the Team');
        $name = 'team~t1~'.$shared['uri'];

        $this->assertContains($name, $this->homeChildren('bob', '/calendars/bob/'));
        $this->assertSame(403, $this->sabre('bob', 'PUT', '/calendars/bob/'.$name.'/x.ics', $this->eventIcs('ro-1'), ['Content-Type' => 'text/calendar'])['status']);
    }

    public function test_a_member_finds_and_edits_the_team_address_book(): void
    {
        $listed = $this->homeChildren('bob', '/addressbooks/bob/');
        $this->assertContains('team~t1~default', $listed);

        $vcard = "BEGIN:VCARD\r\nVERSION:3.0\r\nUID:team-card-1\r\nFN:Team Supplier\r\nN:Supplier;Team;;;\r\nEND:VCARD\r\n";
        $put = $this->sabre('bob', 'PUT', '/addressbooks/bob/team~t1~default/supplier.vcf', $vcard, ['Content-Type' => 'text/vcard']);
        $this->assertContains($put['status'], [201, 204], $put['body']);

        $get = $this->sabre('dave', 'GET', '/addressbooks/dave/team~t1~default/supplier.vcf', '');
        $this->assertSame(200, $get['status'], $get['body']);
        $this->assertStringContainsString('FN:Team Supplier', $get['body']);

        $this->assertSame(403, $this->sabre('bob', 'DELETE', '/addressbooks/bob/team~t1~default/', '')['status']);
        $this->assertSame(404, $this->sabre('carol', 'GET', '/addressbooks/carol/team~t1~default/supplier.vcf', '')['status']);
    }

    /**
     * @param  list<string>  $usernames
     */
    private function putInTeam(string $slug, array $usernames): void
    {
        Principal::query()->firstOrCreate(['uri' => 'principals/groups'], ['displayname' => 'Groups', 'email' => null]);
        $uri = 'principals/groups/'.$slug;
        $team = Principal::query()->where('uri', $uri)->first() ?? $this->seedWgwGroup($uri, strtoupper($slug));
        foreach ($usernames as $username) {
            $member = Principal::forUsername($username);
            $this->assertNotNull($member);
            $this->addPrincipalToGroup($team, $member);
        }
    }

    /**
     * @return list<string>
     */
    private function homeChildren(string $username, string $home): array
    {
        $result = $this->sabre($username, 'PROPFIND', $home, $this->propBody('<d:resourcetype/>'), ['Depth' => '1']);
        $this->assertSame(207, $result['status'], $result['body']);
        preg_match_all('#<d:href>'.preg_quote($home, '#').'([^/<]+)/</d:href>#', $result['body'], $matches);

        return array_map('rawurldecode', $matches[1]);
    }

    private function propBody(string $props): string
    {
        return '<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop>'.$props.'</d:prop></d:propfind>';
    }

    private function eventIcs(string $uid, string $summary = 'Standup'): string
    {
        return "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//WGW//Test//EN\r\n"
            ."BEGIN:VEVENT\r\nUID:{$uid}\r\nDTSTAMP:20300101T000000Z\r\nSUMMARY:{$summary}\r\n"
            ."DTSTART:20300304T100000Z\r\nDTEND:20300304T103000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
    }

    /**
     * @param  array<string, string>  $headers
     * @return array{status: int, body: string}
     */
    private function sabre(string $username, string $method, string $path, string $body, array $headers = []): array
    {
        if ($this->sabreDataDir === null) {
            $this->sabreDataDir = sys_get_temp_dir().'/wgw-sabre-team-home-'.uniqid('', true);
            mkdir($this->sabreDataDir, 0775, true);
            config(['wgw.data_dir' => $this->sabreDataDir]);
        }
        $auth = 'Basic '.base64_encode($username.':secret');
        $_SERVER['HTTP_AUTHORIZATION'] = $auth;
        $this->app->forgetScopedInstances();

        $server = app(SabreServerFactory::class)->create();
        $request = new SabreRequest($method, $path, ['Authorization' => $auth] + $headers + ['Content-Type' => 'application/xml'], $body);
        $request->setBaseUrl('/');
        $response = new SabreResponse;
        $server->httpRequest = $request;
        $server->httpResponse = $response;
        try {
            $server->invokeMethod($request, $response, false);
        } catch (SabreDavException $e) {
            return ['status' => $e->getHTTPCode(), 'body' => $e->getMessage()];
        }

        return ['status' => $response->getStatus(), 'body' => (string) $response->getBodyAsString()];
    }
}
