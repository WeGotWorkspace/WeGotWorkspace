<?php

declare(strict_types=1);

namespace Tests\Feature\Teams;

use App\Dav\SabreServerFactory;
use App\Exceptions\RealtimeApiException;
use App\Models\Principal;
use App\Services\Calendars\Availability\AvailabilitySettings;
use App\Services\Calendars\UserCalendarCollectionsProvisioner;
use App\Services\Jmap\JmapCapabilities;
use App\Services\Principal\PrincipalRoomAuthorizer;
use App\Services\Teams\TeamColleagues;
use App\Services\Teams\TeamRoles;
use App\Support\WgwSettings;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\File;
use Illuminate\Testing\TestResponse;
use Sabre\DAV\Exception as SabreDavException;
use Sabre\HTTP\Request as SabreRequest;
use Sabre\HTTP\Response as SabreResponse;
use Tests\Support\CalendarsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * #2278: the team-admin role widens nothing but the add-member search.
 *
 * bob and dave share T1; carol is alone in T2. Every surface of the colleague rule
 * ({@see TeamColleagues}) is read for bob as a plain member, then again after bob is made
 * team admin of T1. The two readings must be identical. The candidates search is then the
 * one place where bob does find carol.
 */
final class TeamAdminVisibilityTest extends WgwDatabaseTestCase
{
    use CalendarsTestFixtures;

    /** @var array<string, string> */
    private array $tokens = [];

    private ?string $sabreDataDir = null;

    protected function calendarFixtureUsersShareATeam(): bool
    {
        return false;
    }

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpCalendarsFixtures();
        $this->setAppSetting(WgwSettings::CONTACTS_ENABLED, true);
        $this->seedWgwUser('dave', displayName: 'Dave');

        Principal::query()->firstOrCreate(['uri' => 'principals/groups'], ['displayname' => 'Groups', 'email' => null]);
        $t1 = $this->seedWgwGroup('principals/groups/t1', 'T1');
        $t2 = $this->seedWgwGroup('principals/groups/t2', 'T2');
        $this->addPrincipalToGroup($t1, $this->principal('bob'));
        $this->addPrincipalToGroup($t1, $this->principal('dave'));
        $this->addPrincipalToGroup($t2, $this->principal('carol'));

        foreach (['bob', 'carol', 'dave'] as $username) {
            app(UserCalendarCollectionsProvisioner::class)->ensureForPrincipal('principals/'.$username);
            app(AvailabilitySettings::class)->setEnabled($username, true);
        }
    }

    protected function tearDown(): void
    {
        if ($this->sabreDataDir !== null) {
            File::deleteDirectory($this->sabreDataDir);
            $this->sabreDataDir = null;
        }
        parent::tearDown();
    }

    public function test_team_admin_sees_no_more_colleagues_than_a_member(): void
    {
        $asMember = $this->everySurfaceFor('bob');

        app(TeamRoles::class)->appoint('t1', 'bob');
        $this->startNextRequest();
        $this->assertTrue(app(TeamRoles::class)->isTeamAdmin('bob', 't1'));

        $asTeamAdmin = $this->everySurfaceFor('bob');

        foreach ($asMember as $surface => $answer) {
            $this->assertSame($answer, $asTeamAdmin[$surface], 'The team-admin role changed the answer of: '.$surface);
        }
        $this->assertSame(array_keys($asMember), array_keys($asTeamAdmin));
    }

    public function test_the_surfaces_do_hide_the_non_colleague_from_the_team_admin(): void
    {
        app(TeamRoles::class)->appoint('t1', 'bob');
        $this->startNextRequest();

        $surfaces = $this->everySurfaceFor('bob');

        $this->assertStringNotContainsString('carol', json_encode($surfaces['invitees']) ?: '');
        $this->assertStringNotContainsString('carol', json_encode($surfaces['share principals']) ?: '');
        $this->assertSame(400, $surfaces['open a DM'][0]);
        $this->assertSame(['carol'], $surfaces['team member get'][1]);
        $this->assertSame(['carol'], $surfaces['availability']);
        $this->assertSame([false, false, false, false, false], $surfaces['colleague resolver']);
        $this->assertSame('forbidden', $surfaces['presence room']);
        $this->assertSame(['t1'], $surfaces['dav team listing']);
    }

    public function test_the_candidates_search_is_where_a_team_admin_finds_a_non_colleague(): void
    {
        app(TeamRoles::class)->appoint('t1', 'bob');
        $this->startNextRequest();

        $list = $this->asUser('bob')->getJson('/api/v1/teams/t1/member-candidates?q=car')->assertOk()->json('list');

        $this->assertSame([[
            'username' => 'carol',
            'displayName' => (string) $this->principal('carol')->displayname,
            'email' => (string) $this->principal('carol')->email,
            'isMember' => false,
        ]], $list);
    }

    /**
     * One reading per surface of the colleague rule table, each about carol (not a colleague
     * of bob) or about T2 (not bob's Team).
     *
     * @return array<string, mixed>
     */
    private function everySurfaceFor(string $viewer): array
    {
        $colleagues = app(TeamColleagues::class);

        $out = [
            'invitees' => $this->asUser($viewer)->getJson('/api/v1/calendars/scheduling/invitees')->assertOk()->json(),
            'share principals' => $this->asUser($viewer)->getJson('/api/v1/files/shares/principals?q=car')->assertOk()->json(),
            'open a DM' => $this->statusAndBody($this->asUser($viewer)->postJson('/api/v1/chat/dms', ['principal' => 'carol'])),
            'channel list' => array_column(
                (array) $this->asUser($viewer)->getJson('/api/v1/chat/channels')->assertOk()->json('list'),
                'kind',
            ),
            'share a calendar with a user' => $this->jmap($viewer, JmapCapabilities::CALENDARS, 'Calendar/set', [
                'update' => ['default' => ['shareWith' => ['carol' => ['mayReadItems' => true]]]],
            ])['notUpdated'] ?? null,
            'share a calendar with a team' => $this->jmap($viewer, JmapCapabilities::CALENDARS, 'Calendar/set', [
                'update' => ['default' => ['shareWith' => ['groups/t2' => ['mayReadItems' => true]]]],
            ])['notUpdated'] ?? null,
            'team member list' => array_column(
                (array) $this->jmap($viewer, JmapCapabilities::AVAILABILITY, 'TeamMember/get', ['ids' => null])['list'],
                'id',
            ),
        ];

        $get = $this->jmap($viewer, JmapCapabilities::AVAILABILITY, 'TeamMember/get', ['ids' => ['carol']]);
        $out['team member get'] = [$get['list'], $get['notFound']];
        $out['availability'] = $this->jmap($viewer, JmapCapabilities::AVAILABILITY, 'TeamMember/getAvailability', [
            'ids' => ['carol'],
            'utcStart' => '2030-01-07T00:00:00Z',
            'utcEnd' => '2030-01-14T00:00:00Z',
        ])['notFound'];

        $this->startNextRequest();
        $colleagues = app(TeamColleagues::class);
        $out['colleague resolver'] = [
            $colleagues->isColleague($viewer, 'carol'),
            $colleagues->sharesTeamIgnoringAdminRole($viewer, 'carol'),
            $colleagues->isOwnTeam($viewer, 't2'),
            $colleagues->mayShareWithPrincipalUri($viewer, 'principals/carol'),
            $colleagues->mayShareWithPrincipalUri($viewer, 'principals/groups/t2'),
        ];
        $out['colleague set'] = $colleagues->colleagues($viewer)->usernames();

        try {
            app(PrincipalRoomAuthorizer::class)->assertMayJoin('groups.t2', $viewer);
            $out['presence room'] = 'allowed';
        } catch (RealtimeApiException) {
            $out['presence room'] = 'forbidden';
        }

        $body = '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:displayname/></d:prop></d:propfind>';
        $members = '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:group-member-set/></d:prop></d:propfind>';
        $listing = $this->sabre($viewer, 'PROPFIND', '/principals/groups/', $body, '1');
        preg_match_all('#<d:href>/?principals/groups/([^/<]+)/?</d:href>#', $listing['body'], $matches);
        $teams = array_values(array_diff($matches[1], ['calendar-proxy-read', 'calendar-proxy-write']));
        sort($teams);
        $out['dav team listing'] = $teams;
        $out['dav other team'] = $this->sabre($viewer, 'PROPFIND', '/principals/groups/t2/', $members, '0');
        $out['dav other user'] = $this->sabre($viewer, 'PROPFIND', '/principals/carol/', $body, '0');

        return $out;
    }

    /**
     * @return array{0: int, 1: mixed}
     */
    private function statusAndBody(TestResponse $response): array
    {
        return [$response->getStatusCode(), $response->json()];
    }

    /**
     * @param  array<string, mixed>  $args
     * @return array<string, mixed>
     */
    private function jmap(string $username, string $capability, string $method, array $args): array
    {
        $response = $this->asUser($username)->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, $capability],
            'methodCalls' => [[$method, ['accountId' => $username, ...$args], 'c0']],
        ])->assertOk()->json('methodResponses.0');
        $this->assertSame($method, $response[0], json_encode($response) ?: '');

        return $response[1];
    }

    /**
     * @return array{status: int, body: string}
     */
    private function sabre(string $username, string $method, string $path, string $body, string $depth): array
    {
        if ($this->sabreDataDir === null) {
            $this->sabreDataDir = sys_get_temp_dir().'/wgw-sabre-team-admin-'.uniqid('', true);
            mkdir($this->sabreDataDir, 0775, true);
            config(['wgw.data_dir' => $this->sabreDataDir]);
        }
        $auth = 'Basic '.base64_encode($username.':secret');
        $_SERVER['HTTP_AUTHORIZATION'] = $auth;
        // A new DAV request: request-scoped state starts empty.
        $this->app->forgetScopedInstances();

        $server = app(SabreServerFactory::class)->create();
        $request = new SabreRequest($method, $path, [
            'Authorization' => $auth,
            'Depth' => $depth,
            'Content-Type' => 'application/xml',
        ], $body);
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

    private function startNextRequest(): void
    {
        $this->app->instance('request', Request::create('/'));
    }

    private function asUser(string $username): static
    {
        $this->tokens[$username] ??= $this->issueBearerTokenFor($username);

        return $this->withBearer($this->tokens[$username]);
    }

    private function principal(string $username): Principal
    {
        $principal = Principal::forUsername($username);
        $this->assertNotNull($principal);

        return $principal;
    }
}
