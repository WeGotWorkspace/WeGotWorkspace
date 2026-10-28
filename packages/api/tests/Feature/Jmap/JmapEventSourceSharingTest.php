<?php

declare(strict_types=1);

namespace Tests\Feature\Jmap;

use App\Dav\SabreServerFactory;
use App\Models\Principal;
use App\Services\Admin\AdminConstants;
use App\Services\Jmap\JmapCapabilities;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\File;
use Illuminate\Testing\TestResponse;
use Sabre\DAV\Exception as SabreDavException;
use Sabre\HTTP\Request as SabreRequest;
use Sabre\HTTP\Response as SabreResponse;
use Tests\Support\CalendarsTestFixtures;
use Tests\Support\InteractsWithJmapEventSource;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Rights of the JMAP event source (#1660): a sharee hears about the owner's
 * writes over REST and over CalDAV, a user without access hears nothing, and
 * sharing or unsharing a collection changes the sharee's state.
 */
final class JmapEventSourceSharingTest extends WgwDatabaseTestCase
{
    use CalendarsTestFixtures;
    use InteractsWithJmapEventSource;

    private string $davDataDir = '';

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpCalendarsFixtures();
        $this->seedDefaultCalendarFor('alice');
        // The Sabre tree needs the groups principal container and a data dir.
        Principal::query()->firstOrCreate(
            ['uri' => AdminConstants::GROUP_CONTAINER_URI],
            ['email' => null, 'displayname' => 'Groups'],
        );
        $this->davDataDir = sys_get_temp_dir().'/wgw-push-caldav-'.uniqid('', true);
        mkdir($this->davDataDir, 0775, true);
        config(['wgw.data_dir' => $this->davDataDir]);
        Cache::flush();
    }

    protected function tearDown(): void
    {
        if ($this->davDataDir !== '' && is_dir($this->davDataDir)) {
            File::deleteDirectory($this->davDataDir);
        }
        parent::tearDown();
    }

    public function test_a_sharee_hears_an_owner_caldav_write_and_a_stranger_does_not(): void
    {
        $this->createCalendar('alice', 'Planning', 'planning');
        $this->shareCalendar('alice', 'planning', 'bob');
        $bob = $this->readEventSource($this->userBearerToken());
        $carol = $this->readEventSource($this->issueBearerTokenFor('carol'));

        $put = $this->calDav('alice', 'PUT', '/calendars/alice/planning/kickoff.ics', $this->sampleIcs('Kickoff'));
        $this->assertContains($put, [201, 204]);

        $after = $this->readEventSource($this->userBearerToken(), '*', $bob['id']);
        $changed = $this->changedStates($after, 'bob');
        $this->assertSame(['CalendarEvent', 'Calendar'], array_keys($changed));
        $this->assertSame($this->calendarGetState('bob'), $changed['CalendarEvent']);

        $this->assertSame(
            "retry: 3000\n\n",
            $this->eventSource($this->issueBearerTokenFor('carol'), '*', $carol['id'])->getContent(),
        );
    }

    public function test_a_sharee_hears_an_owner_rest_write_and_a_stranger_does_not(): void
    {
        $alice = $this->issueBearerTokenFor('alice');
        $this->withBearer($alice)->postJson('/api/v1/tasks/tasklists', ['name' => 'Errands', 'id' => 'errands'])
            ->assertCreated();
        $this->withBearer($alice)->patchJson('/api/v1/tasks/tasklists/errands', [
            'shareWith' => ['bob' => ['mayReadItems' => true]],
        ])->assertOk();
        $bob = $this->readEventSource($this->userBearerToken());
        $carol = $this->readEventSource($this->issueBearerTokenFor('carol'));

        $this->withBearer($alice)->postJson('/api/v1/tasks/items', [
            'taskListIds' => ['errands' => true],
            'title' => 'Buy stamps',
        ])->assertCreated();

        $after = $this->readEventSource($this->userBearerToken(), '*', $bob['id']);
        $changed = $this->changedStates($after, 'bob');
        $this->assertSame(['Task', 'TaskList'], array_keys($changed));
        $this->assertSame(
            $this->withBearer($this->userBearerToken())->getJson('/api/v1/tasks/tasklists/changes')->json('newState'),
            $changed['TaskList'],
        );

        $this->assertSame(
            "retry: 3000\n\n",
            $this->eventSource($this->issueBearerTokenFor('carol'), '*', $carol['id'])->getContent(),
        );
    }

    public function test_an_owner_write_to_an_unshared_collection_reaches_nobody_else(): void
    {
        $bob = $this->readEventSource($this->userBearerToken());

        $put = $this->calDav('alice', 'PUT', '/calendars/alice/default/private.ics', $this->sampleIcs('Private'));
        $this->assertContains($put, [201, 204]);

        $this->assertSame("retry: 3000\n\n", $this->eventSource($this->userBearerToken(), '*', $bob['id'])->getContent());
    }

    public function test_sharing_and_unsharing_change_the_sharee_state(): void
    {
        $this->createCalendar('alice', 'Roster', 'roster');
        $before = $this->readEventSource($this->userBearerToken());
        $carol = $this->readEventSource($this->issueBearerTokenFor('carol'));

        $this->shareCalendar('alice', 'roster', 'bob');
        $shared = $this->readEventSource($this->userBearerToken(), '*', $before['id']);
        $changed = $this->changedStates($shared, 'bob');
        // The share also lands a "calendar shared with you" item in bob's inbox.
        $this->assertSame(['CalendarEvent', 'Calendar', 'Notification'], array_keys($changed));
        $this->assertSame($this->calendarGetState('bob'), $changed['Calendar']);

        $this->jmap('alice', [
            ['Calendar/set', ['accountId' => 'alice', 'update' => ['roster' => ['shareWith' => ['bob' => null]]]], 'c0'],
        ])->assertOk();
        $unshared = $this->readEventSource($this->userBearerToken(), '*', $shared['id']);
        $changed = $this->changedStates($unshared, 'bob');
        $this->assertSame(['CalendarEvent', 'Calendar'], array_keys($changed));
        $this->assertSame($this->calendarGetState('bob'), $changed['Calendar']);
        // Back to the state before the share: the composite names only what bob can see.
        $this->assertSame($this->changedStates($before, 'bob')['Calendar'], $changed['Calendar']);

        $this->assertSame(
            "retry: 3000\n\n",
            $this->eventSource($this->issueBearerTokenFor('carol'), '*', $carol['id'])->getContent(),
        );
    }

    private function createCalendar(string $owner, string $name, string $id): void
    {
        $created = $this->jmap($owner, [
            ['Calendar/set', ['accountId' => $owner, 'create' => ['c' => ['name' => $name, 'id' => $id]]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.created.c.id');
        $this->assertSame($id, $created);
    }

    private function shareCalendar(string $owner, string $calendarId, string $sharee): void
    {
        $response = $this->jmap($owner, [
            ['Calendar/set', ['accountId' => $owner, 'update' => [$calendarId => [
                'shareWith' => [$sharee => ['mayReadItems' => true]],
            ]]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');
        $this->assertNull($response['notUpdated'][$calendarId] ?? null);
    }

    private function calendarGetState(string $username): string
    {
        return (string) $this->jmap($username, [
            ['Calendar/get', ['accountId' => $username, 'ids' => []], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.state');
    }

    /**
     * @param  list<array{0: string, 1: array<string, mixed>, 2: string}>  $methodCalls
     */
    private function jmap(string $username, array $methodCalls): TestResponse
    {
        $token = $username === 'bob' ? $this->userBearerToken() : $this->issueBearerTokenFor($username);

        return $this->withBearer($token)->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::CALENDARS],
            'methodCalls' => $methodCalls,
        ]);
    }

    /**
     * A CalDAV request through the real Sabre server (plugins included), as `$username`.
     */
    private function calDav(string $username, string $method, string $path, string $body): int
    {
        $auth = 'Basic '.base64_encode($username.':secret');
        $_SERVER['HTTP_AUTHORIZATION'] = $auth;
        $server = app(SabreServerFactory::class)->create();
        $request = new SabreRequest($method, $path, [
            'Authorization' => $auth,
            'Content-Type' => 'text/calendar; charset=utf-8',
        ], $body);
        $request->setBaseUrl('/');
        $response = new SabreResponse;
        $server->httpRequest = $request;
        $server->httpResponse = $response;
        try {
            $server->invokeMethod($request, $response, false);
        } catch (SabreDavException $e) {
            return $e->getHTTPCode();
        }
        $status = $response->getStatus();

        return is_int($status) ? $status : 500;
    }
}
