<?php

declare(strict_types=1);

namespace Tests\Feature\Jmap;

use App\Services\Jmap\JmapCapabilities;
use App\Services\Jmap\Push\JmapPushEventId;
use App\Services\Jmap\Push\JmapPushStateResolver;
use App\Support\WgwSettings;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Support\CalendarsTestFixtures;
use Tests\Support\InteractsWithJmapEventSource;
use Tests\Support\WgwDatabaseTestCase;

/**
 * JMAP event source protocol (RFC 8620 §7.3, #1660): framing, short-burst,
 * the per-type event id and `Last-Event-ID`, the `types` filter, and that
 * every state is the one `Foo/get` returns. Sharing: JmapEventSourceSharingTest.
 * Drive: JmapEventSourceDriveTest. Inbox: JmapEventSourceNotificationTest.
 * Limits: JmapEventSourceRateLimitTest.
 */
final class JmapEventSourceTest extends WgwDatabaseTestCase
{
    use CalendarsTestFixtures;
    use InteractsWithJmapEventSource;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpCalendarsFixtures();
        Cache::flush();
    }

    public function test_requires_a_bearer_token(): void
    {
        $this->get('/api/v1/jmap/events/*/state/0')->assertUnauthorized();
        $this->eventSource('not-a-token')->assertUnauthorized();
    }

    public function test_first_request_sends_every_type_with_an_id_and_retry(): void
    {
        $response = $this->eventSource($this->userBearerToken())->assertOk();
        $this->assertStringStartsWith('text/event-stream', (string) $response->headers->get('Content-Type'));
        $this->assertStringContainsString('no-store', (string) $response->headers->get('Cache-Control'));
        $this->assertFalse($response->headers->has('Server-Timing'));

        $stream = $this->parseEventStream((string) $response->getContent());
        $this->assertSame('state', $stream['event']);
        $this->assertSame(3000, $stream['retry']);
        $this->assertSame(JmapPushStateResolver::TYPES, array_keys($this->changedStates($stream, 'bob')));

        $this->assertIsString($stream['id']);
        $this->assertStringStartsWith('v1;', $stream['id']);
        $hashes = $this->eventIdHashes($stream['id']);
        $this->assertSame(JmapPushStateResolver::TYPES, array_keys($hashes));
        foreach ($hashes as $type => $hash) {
            $this->assertMatchesRegularExpression('/^[0-9a-f]{32}$/', $hash, $type);
        }
    }

    public function test_an_unchanged_last_event_id_ends_with_retry_only(): void
    {
        $token = $this->userBearerToken();
        $first = $this->readEventSource($token);

        $response = $this->eventSource($token, '*', $first['id'])->assertOk();
        $this->assertSame("retry: 3000\n\n", $response->getContent());
    }

    public function test_retry_follows_the_setting(): void
    {
        config(['wgw.jmap_push.retry_ms' => 7000]);
        $token = $this->userBearerToken();

        $first = $this->readEventSource($token);
        $this->assertSame(7000, $first['retry']);
        $this->assertSame("retry: 7000\n\n", $this->eventSource($token, '*', $first['id'])->getContent());
    }

    /**
     * @return array<string, array{0: string, 1: string}>
     */
    public static function closeAfterAndPing(): array
    {
        return [
            'state, no ping' => ['state', '0'],
            'no, no ping' => ['no', '0'],
            'no, ping 300' => ['no', '300'],
            'state, ping 60' => ['state', '60'],
        ];
    }

    #[DataProvider('closeAfterAndPing')]
    public function test_every_response_ends_at_once_whatever_closeafter_and_ping(string $closeafter, string $ping): void
    {
        $token = $this->userBearerToken();

        $first = $this->eventSource($token, '*', null, null, $closeafter, $ping)->assertOk();
        // A plain response with its whole body: nothing is streamed or held.
        $this->assertInstanceOf(Response::class, $first->baseResponse);
        $stream = $this->parseEventStream((string) $first->getContent());
        $this->assertSame('state', $stream['event']);

        $idle = $this->eventSource($token, '*', $stream['id'], null, $closeafter, $ping)->assertOk();
        $this->assertInstanceOf(Response::class, $idle->baseResponse);
        $this->assertSame("retry: 3000\n\n", $idle->getContent());
    }

    public function test_states_are_the_ones_foo_get_returns(): void
    {
        $token = $this->userBearerToken();
        $this->seedEventViaPdo('bob', 'standup.ics', $this->sampleIcs('Standup'));
        $changed = $this->changedStates($this->readEventSource($token), 'bob');

        $getStates = [
            'Note' => ['Note/get', JmapCapabilities::NOTES],
            'Notebook' => ['Notebook/get', JmapCapabilities::NOTES],
            'CalendarEvent' => ['CalendarEvent/get', JmapCapabilities::CALENDARS],
            'Calendar' => ['Calendar/get', JmapCapabilities::CALENDARS],
            'ContactCard' => ['ContactCard/get', JmapCapabilities::CONTACTS],
            'AddressBook' => ['AddressBook/get', JmapCapabilities::CONTACTS],
            'ChatMessage' => ['ChatMessage/get', JmapCapabilities::CHAT],
            'ChatChannel' => ['ChatChannel/get', JmapCapabilities::CHAT],
        ];
        foreach ($getStates as $type => [$method, $urn]) {
            $state = $this->withBearer($token)->postJson('/api/v1/jmap', [
                'using' => [JmapCapabilities::CORE, $urn],
                'methodCalls' => [[$method, ['accountId' => 'bob', 'ids' => []], 'c0']],
            ])->assertOk()->json('methodResponses.0.1.state');
            $this->assertSame($state, $changed[$type], $type);
        }

        $taskListState = $this->withBearer($token)->getJson('/api/v1/tasks/tasklists/changes')->assertOk()->json('newState');
        $this->assertSame($taskListState, $changed['TaskList']);
        $this->assertSame($taskListState, $changed['Task']);
        $this->assertSame('0', $changed['Notification']);
        // FileNode/get equality: JmapEventSourceDriveTest (it needs the drive disk).
    }

    public function test_a_change_sends_only_the_types_that_differ_and_keeps_the_other_hashes(): void
    {
        $token = $this->userBearerToken();
        $first = $this->readEventSource($token);
        $this->assertIsString($first['id']);

        $this->seedEventViaPdo('bob', 'review.ics', $this->sampleIcs('Review'));

        $second = $this->readEventSource($token, '*', $first['id']);
        $this->assertSame(['CalendarEvent', 'Calendar'], array_keys($this->changedStates($second, 'bob')));
        $this->assertIsString($second['id']);

        $before = $this->eventIdHashes($first['id']);
        $after = $this->eventIdHashes($second['id']);
        foreach (JmapPushStateResolver::TYPES as $type) {
            if (in_array($type, ['CalendarEvent', 'Calendar'], true)) {
                $this->assertNotSame($before[$type], $after[$type], $type);
            } else {
                $this->assertSame($before[$type], $after[$type], $type);
            }
        }

        $this->assertSame("retry: 3000\n\n", $this->eventSource($token, '*', $second['id'])->getContent());

        // The client confirmed Calendar but its CalendarEvent sync failed: it
        // rebuilds the id from its confirmed hashes and gets only that type again.
        $rebuilt = $after;
        $rebuilt['CalendarEvent'] = $before['CalendarEvent'];
        $third = $this->readEventSource($token, '*', JmapPushEventId::encode($rebuilt));
        $this->assertSame(['CalendarEvent'], array_keys($this->changedStates($third, 'bob')));
        $this->assertSame($second['id'], $third['id']);
    }

    /**
     * @return array<string, array{0: string}>
     */
    public static function malformedIds(): array
    {
        $hash = str_repeat('a', 32);

        return [
            'garbage' => ['garbage'],
            'other version' => ['v2;Note='.$hash],
            'short hash' => ['v1;Note='.substr($hash, 0, 31)],
            'upper-case hash' => ['v1;Note='.strtoupper($hash)],
            'no hash' => ['v1;Note'],
            'repeated type' => ['v1;Note='.$hash.';Note='.$hash],
            'bad type name' => ['v1;No-te='.$hash],
            'trailing separator' => ['v1;Note='.$hash.';'],
            'too long' => ['v1;'.str_repeat('Note='.$hash.';', 60).'Note='.$hash],
        ];
    }

    #[DataProvider('malformedIds')]
    public function test_a_malformed_id_sends_every_requested_type(string $id): void
    {
        $stream = $this->readEventSource($this->userBearerToken(), '*', $id);

        $this->assertSame(JmapPushStateResolver::TYPES, array_keys($this->changedStates($stream, 'bob')));
    }

    public function test_unknown_types_in_a_well_formed_id_are_ignored(): void
    {
        $token = $this->userBearerToken();
        $first = $this->readEventSource($token);
        $this->assertIsString($first['id']);

        $withExtra = $first['id'].';Mail='.str_repeat('0', 32);
        $this->assertSame("retry: 3000\n\n", $this->eventSource($token, '*', $withExtra)->getContent());
    }

    public function test_the_types_filter_limits_the_state_change_and_the_id(): void
    {
        $token = $this->userBearerToken();

        $some = $this->readEventSource($token, 'Note,FileNode,Bogus');
        $this->assertSame(['Note', 'FileNode'], array_keys($this->changedStates($some, 'bob')));
        $this->assertIsString($some['id']);
        $this->assertSame(['Note', 'FileNode'], array_keys($this->eventIdHashes($some['id'])));

        // With that id, `*` sends every type except the two already confirmed.
        $all = $this->readEventSource($token, '*', $some['id']);
        $this->assertSame(
            array_values(array_diff(JmapPushStateResolver::TYPES, ['Note', 'FileNode'])),
            array_keys($this->changedStates($all, 'bob')),
        );

        $this->assertSame("retry: 3000\n\n", $this->eventSource($token, 'Bogus')->getContent());
    }

    /**
     * @return array<string, array{0: string, 1: string, 2: string}>
     */
    public static function invalidParameters(): array
    {
        return [
            'types with a digit' => ['Note1', 'state', '0'],
            'types with an empty entry' => ['Note,,FileNode', 'state', '0'],
            'types with a trailing comma' => ['Note,', 'state', '0'],
            'types too long' => [str_repeat('Note,', 120).'Note', 'state', '0'],
            'closeafter' => ['*', 'maybe', '0'],
            'negative ping' => ['*', 'state', '-1'],
            'ping not a number' => ['*', 'state', 'soon'],
            'ping too large' => ['*', 'state', '9999999'],
        ];
    }

    #[DataProvider('invalidParameters')]
    public function test_invalid_path_parameters_are_rejected(string $types, string $closeafter, string $ping): void
    {
        $this->eventSource($this->userBearerToken(), $types, null, null, $closeafter, $ping)
            ->assertStatus(400)
            ->assertJsonPath('code', 'bad_request');
    }

    public function test_types_of_a_disabled_app_are_not_served(): void
    {
        $this->setAppSetting(WgwSettings::TASKS_ENABLED, false);
        $this->setAppSetting(WgwSettings::CONTACTS_ENABLED, false);

        $stream = $this->readEventSource($this->userBearerToken());

        $served = array_keys($this->changedStates($stream, 'bob'));
        foreach (['Task', 'TaskList', 'ContactCard', 'AddressBook'] as $type) {
            $this->assertNotContains($type, $served);
        }
        $this->assertContains('Note', $served);
        $this->assertContains('Notification', $served);
    }

    public function test_server_timing_is_opt_in(): void
    {
        config(['wgw.jmap_push.server_timing' => true]);

        $response = $this->eventSource($this->userBearerToken(), 'Note,Notification')->assertOk();

        $timing = (string) $response->headers->get('Server-Timing');
        $this->assertMatchesRegularExpression('/^notes;dur=\d+\.\d{2}, inbox;dur=\d+\.\d{2}$/', $timing);
    }

    public function test_state_reads_do_not_scan_change_rows(): void
    {
        $token = $this->userBearerToken();
        $this->seedEventViaPdo('bob', 'one.ics', $this->sampleIcs('One'));
        $this->readEventSource($token);

        $connection = DB::connection('wgw');
        $connection->flushQueryLog();
        $connection->enableQueryLog();
        $this->readEventSource($token);
        $queries = array_map(static fn (array $query): string => (string) $query['query'], $connection->getQueryLog());
        $connection->disableQueryLog();

        $this->assertNotSame([], $queries);
        foreach ($queries as $sql) {
            // Change logs and per-item rows: a state read must not touch them.
            $this->assertDoesNotMatchRegularExpression(
                '/\b(calendarchanges|addressbookchanges|calendarobjects|cards|jmap_file_nodes|notifications)\b/',
                $sql,
            );
        }
    }
}
