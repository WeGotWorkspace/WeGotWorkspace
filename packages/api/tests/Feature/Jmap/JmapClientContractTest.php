<?php

declare(strict_types=1);

namespace Tests\Feature\Jmap;

use App\Services\Jmap\JmapCapabilities;
use Tests\Support\CalendarsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Chunk F integration verification, option (b) of the plan: the lit-calendar
 * repo is not present in this environment, so instead of running the live
 * unmodified client we replicate — request-for-request — the exact call
 * sequences @lit-calendar/jmap-client (JmapClient/JmapCalendarsClient/
 * JmapEventsAdapter) sends, and assert the responses satisfy the client's
 * TypeScript contracts (core/types.ts, calendars/types.ts — quoted verbatim
 * and independently re-verified in spec §Ground-truth contracts).
 *
 * The lifecycle mirrored here: connect() → refreshCalendars() → loadRange()
 * → sync() → create()/update()/remove() → flush() → sync(). The post-flush
 * sync MUST take the incremental /changes path (no cannotCalculateChanges →
 * #refetchAll() fallback) — the mismatch-13 regression.
 */
final class JmapClientContractTest extends WgwDatabaseTestCase
{
    use CalendarsTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpCalendarsFixtures();
    }

    /**
     * @param  list<array{0: string, 1: array<string, mixed>, 2: string}>  $methodCalls
     */
    private function request(array $methodCalls): array
    {
        // JmapClient.request(): single POST of {using, methodCalls} to
        // session.apiUrl, parsing {methodResponses, sessionState}.
        $response = $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/jmap', [
                'using' => [JmapCapabilities::CORE, JmapCapabilities::CALENDARS],
                'methodCalls' => $methodCalls,
            ])
            ->assertOk()
            ->json();

        $this->assertIsString($response['sessionState']);
        $this->assertIsArray($response['methodResponses']);
        foreach ($response['methodResponses'] as $invocation) {
            $this->assertCount(3, $invocation);
            $this->assertIsString($invocation[0]);
            $this->assertIsArray($invocation[1]);
            $this->assertIsString($invocation[2]);
        }

        return $response['methodResponses'];
    }

    /**
     * @param  array{0: string, 1: array<string, mixed>, 2: string}  $invocation
     * @return array<string, mixed>
     */
    private function assertInvocation(array $invocation, string $name, string $callId): array
    {
        $this->assertSame($name, $invocation[0], 'JmapMethodError would be thrown for: '.json_encode($invocation[1]));
        $this->assertSame($callId, $invocation[2]);

        return $invocation[1];
    }

    public function test_the_full_adapter_lifecycle_against_the_real_backend(): void
    {
        // ---- connect(): GET the Session resource; the client key-checks
        // both capability URNs and derives its accountId from
        // primaryAccounts["urn:ietf:params:jmap:calendars"].
        $session = $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/jmap/session')
            ->assertOk()
            ->json();
        $this->assertArrayHasKey(JmapCapabilities::CORE, $session['capabilities']);
        $this->assertArrayHasKey(JmapCapabilities::CALENDARS, $session['capabilities']);
        $accountId = $session['primaryAccounts'][JmapCapabilities::CALENDARS];
        $this->assertSame('bob', $accountId);

        // The client fetches apiUrl verbatim; it must be absolute and match
        // the batch endpoint this test posts to.
        $this->assertStringEndsWith('/api/v1/jmap', $session['apiUrl']);
        $this->assertMatchesRegularExpression('#^https?://#', $session['apiUrl']);

        // ---- refreshCalendars(): Calendar/get {accountId, ids: null}.
        [$calendarGet] = $this->request([
            ['Calendar/get', ['accountId' => $accountId, 'ids' => null], '0'],
        ]);
        $calendars = $this->assertInvocation($calendarGet, 'Calendar/get', '0');
        $this->assertGetResponseShape($calendars, $accountId);
        $calendar = $calendars['list'][0];
        foreach (['id', 'name'] as $required) {
            $this->assertIsString($calendar[$required]);
        }
        foreach ([
            'mayReadFreeBusy', 'mayReadItems', 'mayWriteAll', 'mayWriteOwn',
            'mayUpdatePrivate', 'mayRSVP', 'mayShare', 'mayDelete',
        ] as $right) {
            $this->assertIsBool($calendar['myRights'][$right], $right);
        }
        $calendarState = $calendars['state'];

        // ---- loadRange(): getCalendarEventsInRange() sends query + get in
        // one batch wired with "#ids" (path "/ids"); the filter carries only
        // after/before — never inCalendars (JmapEventsAdapter.loadRange()).
        $seededId = $this->seedEventViaPdo('bob', 'lifecycle.ics', $this->sampleIcs(
            'Lifecycle',
            start: '20320310T100000Z',
            end: '20320310T110000Z',
        ));
        $range = ['after' => '2032-03-01T00:00:00Z', 'before' => '2032-04-01T00:00:00Z'];

        [$query, $get] = $this->request([
            ['CalendarEvent/query', ['accountId' => $accountId, 'filter' => $range], '0'],
            ['CalendarEvent/get', [
                'accountId' => $accountId,
                '#ids' => ['resultOf' => '0', 'name' => 'CalendarEvent/query', 'path' => '/ids'],
            ], '1'],
        ]);

        $queryArgs = $this->assertInvocation($query, 'CalendarEvent/query', '0');
        $this->assertIsString($queryArgs['queryState']);
        $this->assertFalse($queryArgs['canCalculateChanges']);
        $this->assertIsInt($queryArgs['position']);
        $this->assertSame([$seededId], $queryArgs['ids']);

        $getArgs = $this->assertInvocation($get, 'CalendarEvent/get', '1');
        $this->assertGetResponseShape($getArgs, $accountId);
        $event = $getArgs['list'][0];
        $this->assertSame($seededId, $event['id']);
        $this->assertSame('Lifecycle', $event['title']);
        $this->assertSame(['default' => true], $event['calendarIds']);
        $eventState = $getArgs['state'];

        // ---- sync(): calendarChanges + calendarEventChanges, both
        // account-wide with no calendarId (JmapCalendarsClient).
        [$calendarChanges, $eventChanges] = $this->request([
            ['Calendar/changes', ['accountId' => $accountId, 'sinceState' => $calendarState], '0'],
            ['CalendarEvent/changes', ['accountId' => $accountId, 'sinceState' => $eventState], '1'],
        ]);
        $this->assertChangesResponseShape($this->assertInvocation($calendarChanges, 'Calendar/changes', '0'), $accountId, $calendarState);
        $idle = $this->assertInvocation($eventChanges, 'CalendarEvent/changes', '1');
        $this->assertChangesResponseShape($idle, $accountId, $eventState);
        $this->assertSame([], $idle['created']);

        // ---- create()/update()/remove() + flush(): setCalendarEvents()
        // sends create/update/destroy without ifInState.
        [$set] = $this->request([
            ['CalendarEvent/set', [
                'accountId' => $accountId,
                'create' => ['temp-1' => $this->sampleCalendarEventPayload()],
            ], '0'],
        ]);
        $setArgs = $this->assertInvocation($set, 'CalendarEvent/set', '0');
        $this->assertIsString($setArgs['newState']);
        $createdId = (string) $setArgs['created']['temp-1']['id'];
        $this->assertNotSame('', $createdId);

        // ---- post-flush sync(): the mismatch-13 regression. The client
        // replays the state it held BEFORE the write; the response must be
        // an incremental delta, never a cannotCalculateChanges error (which
        // would trigger the adapter's expensive #refetchAll()).
        [$postFlush] = $this->request([
            ['CalendarEvent/changes', ['accountId' => $accountId, 'sinceState' => $eventState], '0'],
        ]);
        $delta = $this->assertInvocation($postFlush, 'CalendarEvent/changes', '0');
        $this->assertChangesResponseShape($delta, $accountId, $eventState);
        $this->assertContains($createdId, $delta['created']);

        // And the set's own newState feeds the next incremental sync.
        [$next] = $this->request([
            ['CalendarEvent/changes', ['accountId' => $accountId, 'sinceState' => $setArgs['newState']], '0'],
        ]);
        $settled = $this->assertInvocation($next, 'CalendarEvent/changes', '0');
        $this->assertSame([], $settled['created']);
        $this->assertSame([], $settled['updated']);
        $this->assertSame([], $settled['destroyed']);
    }

    /**
     * GetResponse<T> per core/types.ts: {accountId, state, list, notFound}.
     *
     * @param  array<string, mixed>  $args
     */
    private function assertGetResponseShape(array $args, string $accountId): void
    {
        $this->assertSame($accountId, $args['accountId']);
        $this->assertIsString($args['state']);
        $this->assertIsArray($args['list']);
        $this->assertIsArray($args['notFound']);
    }

    /**
     * ChangesResponse per core/types.ts: {accountId, oldState, newState,
     * hasMoreChanges, created, updated, destroyed}.
     *
     * @param  array<string, mixed>  $args
     */
    private function assertChangesResponseShape(array $args, string $accountId, string $sinceState): void
    {
        $this->assertSame($accountId, $args['accountId']);
        $this->assertSame($sinceState, $args['oldState']);
        $this->assertIsString($args['newState']);
        $this->assertIsBool($args['hasMoreChanges']);
        $this->assertIsArray($args['created']);
        $this->assertIsArray($args['updated']);
        $this->assertIsArray($args['destroyed']);
    }
}
