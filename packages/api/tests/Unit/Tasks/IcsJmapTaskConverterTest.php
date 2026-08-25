<?php

declare(strict_types=1);

namespace Tests\Unit\Tasks;

use App\Services\Tasks\Conversion\IcsJmapTaskConverter;
use App\Services\Tasks\Conversion\IcsToJmapTaskConverter;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class IcsJmapTaskConverterTest extends TestCase
{
    private IcsJmapTaskConverter $converter;

    private IcsToJmapTaskConverter $reader;

    private string $fixturesDir;

    protected function setUp(): void
    {
        parent::setUp();
        $this->converter = new IcsJmapTaskConverter;
        $this->reader = new IcsToJmapTaskConverter;
        $this->fixturesDir = dirname(__DIR__, 2).'/fixtures/Tasks';
    }

    /**
     * @return array<string, array{0: string}>
     */
    public static function goldenFixtureProvider(): array
    {
        $fixtures = [];
        foreach (glob(dirname(__DIR__, 2).'/fixtures/Tasks/*.ics') ?: [] as $path) {
            $name = basename($path, '.ics');
            if ($name === 'multi-vtodo') {
                continue;
            }
            $jsonPath = dirname($path).'/'.$name.'.json';
            if (is_file($jsonPath)) {
                $fixtures[$name] = [$name];
            }
        }

        return $fixtures;
    }

    #[DataProvider('goldenFixtureProvider')]
    public function test_ics_to_jmap_matches_golden_fixture(string $fixture): void
    {
        $ics = str_replace("\n", "\r\n", (string) file_get_contents("{$this->fixturesDir}/{$fixture}.ics"));
        $expected = json_decode((string) file_get_contents("{$this->fixturesDir}/{$fixture}.json"), true);

        $tasks = $this->reader->tasksFromIcs($ics);
        $this->assertCount(1, $tasks);
        $this->assertSame($expected, $tasks[0]);
    }

    public function test_multi_vtodo_splits_into_multiple_tasks(): void
    {
        $ics = str_replace("\n", "\r\n", (string) file_get_contents("{$this->fixturesDir}/multi-vtodo.ics"));
        $tasks = $this->reader->tasksFromIcs($ics);

        $this->assertCount(2, $tasks);
        $this->assertSame('Task A', $tasks[0]['title']);
        $this->assertSame('needs-action', $tasks[0]['workflowStatus']);
        $this->assertSame('Task B', $tasks[1]['title']);
        $this->assertSame('in-process', $tasks[1]['workflowStatus']);
        $this->assertSame(50, $tasks[1]['progress']);
    }

    public function test_round_trip_preserves_core_fields(): void
    {
        $ics = str_replace("\n", "\r\n", (string) file_get_contents("{$this->fixturesDir}/simple-todo.ics"));
        $tasks = $this->reader->tasksFromIcs($ics);
        $this->assertCount(1, $tasks);

        $roundTrip = $this->converter->tasksFromIcs($this->converter->icsFromTask($tasks[0]));
        $this->assertCount(1, $roundTrip);
        $this->assertSame($tasks[0]['uid'], $roundTrip[0]['uid']);
        $this->assertSame($tasks[0]['title'], $roundTrip[0]['title']);
        $this->assertSame($tasks[0]['due'], $roundTrip[0]['due']);
        $this->assertSame($tasks[0]['workflowStatus'], $roundTrip[0]['workflowStatus']);
    }

    public function test_workflow_status_mapping(): void
    {
        $ics = str_replace("\n", "\r\n", (string) file_get_contents("{$this->fixturesDir}/completed-todo.ics"));
        $tasks = $this->reader->tasksFromIcs($ics);

        $this->assertSame('completed', $tasks[0]['workflowStatus']);
        $this->assertSame(100, $tasks[0]['progress']);
        $this->assertSame('2026-06-10T12:00:00Z', $tasks[0]['completed']);
    }

    public function test_recurring_task_preserves_rrule_and_exdate(): void
    {
        $ics = str_replace("\n", "\r\n", (string) file_get_contents("{$this->fixturesDir}/recurring-todo.ics"));
        $tasks = $this->reader->tasksFromIcs($ics);

        $this->assertCount(1, $tasks);
        $this->assertSame('daily', $tasks[0]['recurrenceRules'][0]['frequency']);
        $this->assertSame(5, $tasks[0]['recurrenceRules'][0]['count']);
        $this->assertSame(['2026-06-03T09:00:00'], $tasks[0]['excludedRecurrenceDates']);

        $roundTrip = $this->converter->tasksFromIcs($this->converter->icsFromTask($tasks[0]));
        $this->assertSame('daily', $roundTrip[0]['recurrenceRules'][0]['frequency']);
        $this->assertSame(['2026-06-03T09:00:00'], $roundTrip[0]['excludedRecurrenceDates']);
    }

    public function test_recurrence_override_from_recurrence_id(): void
    {
        $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VTODO\r\nUID:series-1\r\nSUMMARY:Weekly review\r\nDUE:20260602T100000\r\nRRULE:FREQ=WEEKLY\r\nEND:VTODO\r\nBEGIN:VTODO\r\nUID:series-1\r\nRECURRENCE-ID:20260609T100000\r\nSUMMARY:Weekly review (moved)\r\nDUE:20260609T140000\r\nSTATUS:NEEDS-ACTION\r\nEND:VTODO\r\nEND:VCALENDAR\r\n";

        $tasks = $this->reader->tasksFromIcs($ics);
        $this->assertCount(1, $tasks);
        $this->assertSame('Weekly review', $tasks[0]['title']);
        $this->assertSame('weekly', $tasks[0]['recurrenceRules'][0]['frequency']);
        $this->assertSame('Weekly review (moved)', $tasks[0]['recurrenceOverrides']['2026-06-09T10:00:00']['title']);
        $this->assertSame('2026-06-09T14:00:00', $tasks[0]['recurrenceOverrides']['2026-06-09T10:00:00']['due']);
    }

    public function test_valarm_maps_to_jmap_alerts(): void
    {
        $ics = str_replace("\n", "\r\n", (string) file_get_contents("{$this->fixturesDir}/todo-with-alarm.ics"));
        $expected = json_decode((string) file_get_contents("{$this->fixturesDir}/todo-with-alarm.json"), true);

        $tasks = $this->reader->tasksFromIcs($ics);
        $this->assertCount(1, $tasks);
        $this->assertSame($expected['alerts'], $tasks[0]['alerts']);
    }

    public function test_alert_round_trip_writes_valarm(): void
    {
        $task = [
            '@type' => 'Task',
            'uid' => 'urn:uuid:alert-roundtrip',
            'title' => 'Reminder task',
            'due' => '2026-06-15T17:00:00',
            'isDraft' => false,
            'sortOrder' => 0,
            'alerts' => [
                'a1' => [
                    '@type' => 'Alert',
                    'trigger' => [
                        '@type' => 'OffsetTrigger',
                        'offset' => '-PT30M',
                        'relativeTo' => 'end',
                    ],
                ],
            ],
        ];

        $ics = $this->converter->icsFromTask($task);
        $this->assertStringContainsString('BEGIN:VALARM', $ics);
        $this->assertStringContainsString('TRIGGER;RELATED=END:-PT30M', $ics);

        $roundTrip = $this->reader->tasksFromIcs($ics);
        $this->assertSame('-PT30M', $roundTrip[0]['alerts']['alert1']['trigger']['offset']);
        $this->assertSame('end', $roundTrip[0]['alerts']['alert1']['trigger']['relativeTo']);
    }

    public function test_all_day_due_preserves_value_date(): void
    {
        $ics = str_replace("\n", "\r\n", (string) file_get_contents("{$this->fixturesDir}/all-day-todo.ics"));
        $expected = json_decode((string) file_get_contents("{$this->fixturesDir}/all-day-todo.json"), true);

        $tasks = $this->reader->tasksFromIcs($ics);
        $this->assertSame($expected, $tasks[0]);

        $roundTripIcs = $this->converter->icsFromTask($tasks[0]);
        $this->assertStringContainsString('DUE;VALUE=DATE:20260620', $roundTripIcs);

        $roundTrip = $this->reader->tasksFromIcs($roundTripIcs);
        $this->assertTrue($roundTrip[0]['showWithoutTime']);
        $this->assertSame('2026-06-20', $roundTrip[0]['due']);
    }

    public function test_tzid_round_trip_on_start_and_due(): void
    {
        $ics = str_replace("\n", "\r\n", (string) file_get_contents("{$this->fixturesDir}/tzid-todo.ics"));
        $expected = json_decode((string) file_get_contents("{$this->fixturesDir}/tzid-todo.json"), true);

        $tasks = $this->reader->tasksFromIcs($ics);
        $this->assertSame($expected, $tasks[0]);

        $roundTripIcs = $this->converter->icsFromTask($tasks[0]);
        $this->assertStringContainsString('TZID=Europe/Amsterdam', $roundTripIcs);
        $this->assertStringContainsString('BEGIN:VTIMEZONE', $roundTripIcs);
        $this->assertStringContainsString('TZID:Europe/Amsterdam', $roundTripIcs);

        $roundTrip = $this->reader->tasksFromIcs($roundTripIcs);
        $this->assertSame('Europe/Amsterdam', $roundTrip[0]['timeZone']);
    }

    public function test_ics_props_survives_round_trip(): void
    {
        $ics = str_replace("\n", "\r\n", (string) file_get_contents("{$this->fixturesDir}/ics-props-todo.ics"));
        $expected = json_decode((string) file_get_contents("{$this->fixturesDir}/ics-props-todo.json"), true);

        $tasks = $this->reader->tasksFromIcs($ics);
        $this->assertSame($expected, $tasks[0]);

        $roundTrip = $this->reader->tasksFromIcs($this->converter->icsFromTask($tasks[0]));
        $this->assertSame(['X-CUSTOM-PROP' => 'preserved-value'], $roundTrip[0]['icsProps']);
    }

    public function test_participants_round_trip(): void
    {
        $ics = str_replace("\n", "\r\n", (string) file_get_contents("{$this->fixturesDir}/participants-todo.ics"));
        $expected = json_decode((string) file_get_contents("{$this->fixturesDir}/participants-todo.json"), true);

        $tasks = $this->reader->tasksFromIcs($ics);
        $this->assertSame($expected['participants'], $tasks[0]['participants']);

        $roundTripIcs = $this->converter->icsFromTask($tasks[0]);
        $this->assertStringContainsString('ORGANIZER;CN=Alice:mailto:alice@example.com', $roundTripIcs);
        $this->assertStringContainsString('ATTENDEE;CN=Bob;PARTSTAT=ACCEPTED:mailto:bob@example.com', $roundTripIcs);

        $roundTrip = $this->reader->tasksFromIcs($roundTripIcs);
        $this->assertSame('Alice', $roundTrip[0]['participants']['org']['name']);
        $this->assertSame('accepted', $roundTrip[0]['participants']['att1']['participationStatus']);
    }

    public function test_priority_round_trip_preserves_ical_values(): void
    {
        $task = [
            '@type' => 'Task',
            'uid' => 'urn:uuid:priority-roundtrip',
            'title' => 'Priority task',
            'due' => '2026-06-15T17:00:00',
            'priority' => 1,
            'isDraft' => false,
            'sortOrder' => 0,
        ];

        $ics = $this->converter->icsFromTask($task);
        $this->assertStringContainsString('PRIORITY:1', $ics);

        $roundTrip = $this->reader->tasksFromIcs($ics);
        $this->assertSame(1, $roundTrip[0]['priority']);
    }

    public function test_read_ical_priority_maps_to_same_rest_value(): void
    {
        $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VTODO\r\nUID:urn:uuid:prio-medium\r\nSUMMARY:Medium\r\nPRIORITY:5\r\nEND:VTODO\r\nEND:VCALENDAR\r\n";
        $tasks = $this->reader->tasksFromIcs($ics);

        $this->assertSame(5, $tasks[0]['priority']);
    }

    public function test_completed_always_normalized_to_utc_z(): void
    {
        $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VTODO\r\nUID:completed-tz\r\nSUMMARY:Done\r\nCOMPLETED:20260610T120000\r\nSTATUS:COMPLETED\r\nEND:VTODO\r\nEND:VCALENDAR\r\n";

        $tasks = $this->reader->tasksFromIcs($ics);
        $this->assertSame('2026-06-10T12:00:00Z', $tasks[0]['completed']);

        $roundTripIcs = $this->converter->icsFromTask($tasks[0]);
        $this->assertStringContainsString('COMPLETED:20260610T120000Z', $roundTripIcs);
    }
}
