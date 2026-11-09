<?php

declare(strict_types=1);

namespace Tests\Feature\Dav;

use App\Dav\SabreServerFactory;
use App\Dav\Server\CalDavDeliveryRecipients;
use App\Models\Principal;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Mail;
use Sabre\DAV\Exception as SabreDavException;
use Sabre\HTTP\Request as SabreRequest;
use Sabre\HTTP\Response as SabreResponse;
use Sabre\VObject\Reader;
use Tests\Support\CalendarsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Calendar apps see only their own Teams and colleagues (Task #1922).
 *
 * bob and dave share Team t1. carol and erin share Team t2. alice is the admin
 * and in no Team with anyone else.
 */
final class CalDavTeamDirectoryTest extends WgwDatabaseTestCase
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
        foreach (['dave' => 'Dave', 'erin' => 'Erin'] as $username => $name) {
            $this->seedWgwUser($username, displayName: $name);
            $this->seedDefaultCalendarFor($username);
        }
        $this->seedDefaultCalendarFor('alice');
        $this->putInTeam('t1', ['bob', 'dave']);
        $this->putInTeam('t2', ['carol', 'erin']);
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

    // ---- principals/groups/ ---------------------------------------------------

    public function test_a_member_lists_only_their_own_teams(): void
    {
        $this->assertSame(['t1'], $this->listedTeams('bob'));
        $this->assertSame(['t2'], $this->listedTeams('carol'));
    }

    public function test_an_admin_lists_every_team(): void
    {
        $listed = $this->listedTeams('alice');

        $this->assertContains('t1', $listed);
        $this->assertContains('t2', $listed);
    }

    public function test_a_team_member_set_is_readable_by_members_and_admins_only(): void
    {
        $this->assertSame(['carol', 'erin'], $this->memberSet('carol', 't2'));
        $this->assertSame(['carol', 'erin'], $this->memberSet('alice', 't2'));

        $foreign = $this->propfind('bob', '/principals/groups/t2/', $this->memberSetBody(), '0');
        $unknown = $this->propfind('bob', '/principals/groups/no-such-team/', $this->memberSetBody(), '0');
        $this->assertSame(404, $foreign['status']);
        $this->assertSame($this->withoutName($unknown, 'no-such-team'), $this->withoutName($foreign, 't2'));
    }

    public function test_a_team_nested_in_a_hidden_team_does_not_break_the_members_requests(): void
    {
        $t1 = Principal::query()->where('uri', 'principals/groups/t1')->firstOrFail();
        $t2 = Principal::query()->where('uri', 'principals/groups/t2')->firstOrFail();
        $this->addPrincipalToGroup($t1, $t2);

        $this->assertSame(207, $this->propfind('carol', '/principals/carol/', $this->displayNameBody(), '0')['status']);
        $this->assertSame(['t2'], $this->listedTeams('carol'));
        $this->assertSame(404, $this->propfind('carol', '/principals/groups/t1/', $this->memberSetBody(), '0')['status']);
    }

    // ---- principals/{user} ----------------------------------------------------

    public function test_a_non_colleague_principal_answers_like_an_unknown_account(): void
    {
        $this->assertSame(207, $this->propfind('bob', '/principals/dave/', $this->displayNameBody(), '0')['status']);

        $carol = $this->propfind('bob', '/principals/carol/', $this->displayNameBody(), '0');
        $unknown = $this->propfind('bob', '/principals/nobody/', $this->displayNameBody(), '0');
        $this->assertSame(404, $carol['status']);
        $this->assertSame($this->withoutName($unknown, 'nobody'), $this->withoutName($carol, 'carol'));
    }

    public function test_an_admin_resolves_every_principal(): void
    {
        $this->assertSame(207, $this->propfind('alice', '/principals/carol/', $this->displayNameBody(), '0')['status']);
    }

    // ---- CalDAV scheduling with the filtered tree -------------------------------

    public function test_caldav_invite_reaches_a_colleague_and_treats_a_non_colleague_like_an_external_address(): void
    {
        $uid = 'g-invite-'.uniqid();
        $status = $this->davPut('bob', '/calendars/bob/default/g.ics', $this->inviteIcs($uid, 'bob', ['dave@example.test', 'carol@example.test', 'guest@elsewhere.test']));

        $this->assertContains($status, [201, 204]);
        $this->assertSame([$uid], $this->ownedUids('dave'));
        $this->assertSame([], $this->ownedUids('carol'));
        $this->assertSame([], $this->inboxRows('carol'));

        $scheduleStatus = $this->attendeeScheduleStatuses('bob', $uid);
        $this->assertStringStartsWith('1.2', (string) $scheduleStatus['dave@example.test']);
        $this->assertSame($scheduleStatus['guest@elsewhere.test'], $scheduleStatus['carol@example.test']);
    }

    public function test_an_admin_invites_anyone_locally_and_the_caldav_reply_comes_back(): void
    {
        $uid = 'g-admin-'.uniqid();
        $this->assertContains($this->davPut('alice', '/calendars/alice/default/admin.ics', $this->inviteIcs($uid, 'alice', ['carol@example.test'])), [201, 204]);
        $this->assertSame([$uid], $this->ownedUids('carol'));

        $copyUri = (string) DB::connection('wgw')->table('calendarobjects')
            ->join('calendarinstances', 'calendarinstances.calendarid', '=', 'calendarobjects.calendarid')
            ->where('calendarinstances.principaluri', 'principals/carol')
            ->where('calendarobjects.uid', $uid)
            ->value('calendarobjects.uri');
        $accepted = str_replace('PARTSTAT=NEEDS-ACTION', 'PARTSTAT=ACCEPTED', $this->inviteIcs($uid, 'alice', ['carol@example.test']));
        $this->assertContains($this->davPut('carol', '/calendars/carol/default/'.$copyUri, $accepted), [201, 204]);

        $organizerCopy = Reader::read($this->calendarData('alice', $uid));
        $partstats = [];
        foreach ($organizerCopy->VEVENT->ATTENDEE ?? [] as $attendee) {
            $partstats[strtolower((string) $attendee)] = (string) ($attendee['PARTSTAT'] ?? '');
        }
        $this->assertSame('ACCEPTED', $partstats['mailto:carol@example.test'] ?? null);
    }

    public function test_the_delivery_pass_does_not_outlive_the_request(): void
    {
        $recipients = app(CalDavDeliveryRecipients::class);
        $recipients->allow('principals/carol');
        $this->assertTrue($recipients->allows('principals/carol'));

        $this->app->instance('request', Request::create('/next'));

        $this->assertFalse(app(CalDavDeliveryRecipients::class)->allows('principals/carol'));
    }

    // ---- helpers ----------------------------------------------------------------

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
    private function listedTeams(string $username): array
    {
        $result = $this->propfind($username, '/principals/groups/', $this->displayNameBody(), '1');
        $this->assertSame(207, $result['status'], $result['body']);
        preg_match_all('#<d:href>/?principals/groups/([^/<]+)/?</d:href>#', $result['body'], $matches);
        $teams = array_values(array_diff($matches[1], ['calendar-proxy-read', 'calendar-proxy-write']));
        sort($teams);

        return $teams;
    }

    /**
     * @return list<string>
     */
    private function memberSet(string $username, string $slug): array
    {
        $result = $this->propfind($username, '/principals/groups/'.$slug.'/', $this->memberSetBody(), '0');
        $this->assertSame(207, $result['status'], $result['body']);
        preg_match_all('#<d:href>/?principals/([^/<]+)/?</d:href>#', $result['body'], $matches);
        $members = array_values(array_diff($matches[1], ['groups']));
        sort($members);

        return $members;
    }

    private function displayNameBody(): string
    {
        return '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:displayname/></d:prop></d:propfind>';
    }

    private function memberSetBody(): string
    {
        return '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:group-member-set/></d:prop></d:propfind>';
    }

    /**
     * @param  array{status: int, body: string}  $result
     * @return array{status: int, body: string}
     */
    private function withoutName(array $result, string $name): array
    {
        return ['status' => $result['status'], 'body' => str_replace($name, '{name}', $result['body'])];
    }

    /**
     * @return array{status: int, body: string}
     */
    private function propfind(string $username, string $path, string $body, string $depth): array
    {
        return $this->sabre($username, 'PROPFIND', $path, $body, ['Depth' => $depth, 'Content-Type' => 'application/xml']);
    }

    private function davPut(string $username, string $path, string $ics): int
    {
        return $this->sabre($username, 'PUT', $path, $ics, ['Content-Type' => 'text/calendar'])['status'];
    }

    /**
     * @param  list<string>  $attendees
     */
    private function inviteIcs(string $uid, string $organizer, array $attendees): string
    {
        $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//WGW//Test//EN\r\n"
            ."BEGIN:VEVENT\r\nUID:{$uid}\r\nDTSTAMP:20300101T000000Z\r\nSEQUENCE:0\r\nSUMMARY:Planning\r\n"
            ."DTSTART:20300304T100000Z\r\nDTEND:20300304T110000Z\r\n"
            ."ORGANIZER:mailto:{$organizer}@example.test\r\n";
        foreach ($attendees as $attendee) {
            $ics .= "ATTENDEE;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:{$attendee}\r\n";
        }

        return $ics."END:VEVENT\r\nEND:VCALENDAR\r\n";
    }

    /**
     * @return list<string>
     */
    private function ownedUids(string $username): array
    {
        return array_values(DB::connection('wgw')->table('calendarobjects')
            ->join('calendarinstances', 'calendarinstances.calendarid', '=', 'calendarobjects.calendarid')
            ->where('calendarinstances.principaluri', 'principals/'.$username)
            ->where('calendarinstances.access', 1)
            ->pluck('calendarobjects.uid')
            ->map(static fn (mixed $uid): string => (string) $uid)
            ->all());
    }

    /**
     * @return list<string>
     */
    private function inboxRows(string $username): array
    {
        return array_values(DB::connection('wgw')->table('schedulingobjects')
            ->where('principaluri', 'principals/'.$username)
            ->pluck('calendardata')
            ->map(static fn (mixed $data): string => (string) $data)
            ->all());
    }

    private function calendarData(string $username, string $uid): string
    {
        $data = DB::connection('wgw')->table('calendarobjects')
            ->join('calendarinstances', 'calendarinstances.calendarid', '=', 'calendarobjects.calendarid')
            ->where('calendarinstances.principaluri', 'principals/'.$username)
            ->where('calendarobjects.uid', $uid)
            ->value('calendarobjects.calendardata');
        $this->assertNotNull($data);

        return (string) $data;
    }

    /**
     * @return array<string, string|null>
     */
    private function attendeeScheduleStatuses(string $organizer, string $uid): array
    {
        $statuses = [];
        foreach (Reader::read($this->calendarData($organizer, $uid))->VEVENT->ATTENDEE ?? [] as $attendee) {
            $address = strtolower(preg_replace('/^mailto:/i', '', (string) $attendee) ?? '');
            $statuses[$address] = isset($attendee['SCHEDULE-STATUS']) ? (string) $attendee['SCHEDULE-STATUS'] : null;
        }

        return $statuses;
    }

    /**
     * @param  array<string, string>  $headers
     * @return array{status: int, body: string}
     */
    private function sabre(string $username, string $method, string $path, string $body, array $headers = []): array
    {
        if ($this->sabreDataDir === null) {
            $this->sabreDataDir = sys_get_temp_dir().'/wgw-sabre-teams-'.uniqid('', true);
            mkdir($this->sabreDataDir, 0775, true);
            config(['wgw.data_dir' => $this->sabreDataDir]);
        }
        $auth = 'Basic '.base64_encode($username.':secret');
        $_SERVER['HTTP_AUTHORIZATION'] = $auth;
        // A new DAV request: request-scoped state starts empty.
        $this->app->forgetScopedInstances();

        $server = app(SabreServerFactory::class)->create();
        $request = new SabreRequest($method, $path, ['Authorization' => $auth] + $headers, $body);
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
