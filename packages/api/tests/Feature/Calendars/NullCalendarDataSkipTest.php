<?php

declare(strict_types=1);

namespace Tests\Feature\Calendars;

use App\Models\SearchDocument;
use App\Services\Notify\AlertDueScheduler;
use App\Services\Search\SearchIndexerService;
use DateTimeImmutable;
use DateTimeZone;
use Illuminate\Database\QueryException;
use Illuminate\Log\Events\MessageLogged;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Tests\Support\CalendarsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

final class NullCalendarDataSkipTest extends WgwDatabaseTestCase
{
    use CalendarsTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpCalendarsFixtures();
    }

    public function test_null_calendardata_is_skipped_with_a_warning(): void
    {
        $uri = 'null-data.ics';
        $this->seedEventViaPdo('bob', $uri, $this->sampleIcs('Null data'));
        $this->storeNullCalendarData($uri);
        $objectId = (int) DB::connection('wgw')->table('calendarobjects')->where('uri', $uri)->value('id');

        Cache::forget('alerts:null-calendardata-warned');
        $warnings = [];
        Log::listen(function (MessageLogged $event) use (&$warnings): void {
            if ($event->level === 'warning') {
                $warnings[] = [
                    'message' => $event->message,
                    'context' => $event->context,
                ];
            }
        });

        app(SearchIndexerService::class)->indexCalendarObjectFromPath('calendars/bob/default/'.$uri);
        $now = new DateTimeImmutable('2026-09-12T12:00:00Z', new DateTimeZone('UTC'));
        $fired = app(AlertDueScheduler::class)->scan($now);

        $this->assertSame(0, $fired);
        $this->assertSame(
            0,
            SearchDocument::query()
                ->where('source_type', 'caldav')
                ->where('source_key', 'bob|default|'.$uri)
                ->count(),
        );
        $indexerWarnings = array_values(array_filter(
            $warnings,
            static fn (array $warning): bool => $warning['message'] === 'Skipping calendar object with null calendardata.',
        ));
        $this->assertCount(1, $indexerWarnings);

        $summaries = self::nullCalendarDataSummaries($warnings);
        $this->assertCount(1, $summaries);
        $this->assertSame('1 calendar objects with NULL calendardata skipped', $summaries[0]['message']);
        $this->assertSame(1, $summaries[0]['context']['count']);
        $this->assertSame([$objectId], $summaries[0]['context']['ids']);

        $logged = count($warnings);
        $db = DB::connection('wgw');
        $db->flushQueryLog();
        $db->enableQueryLog();
        $this->assertSame(0, app(AlertDueScheduler::class)->scan($now));
        $nullScans = array_values(array_filter(
            $db->getQueryLog(),
            static fn (array $query): bool => str_contains(strtolower($query['query']), 'calendardata')
                && str_contains(strtolower($query['query']), 'is null'),
        ));
        $db->disableQueryLog();
        $this->assertSame([], $nullScans);
        $this->assertSame([], self::nullCalendarDataSummaries(array_slice($warnings, $logged)));
    }

    /**
     * @param  list<array{message: string, context: array<string, mixed>}>  $warnings
     * @return list<array{message: string, context: array<string, mixed>}>
     */
    private static function nullCalendarDataSummaries(array $warnings): array
    {
        return array_values(array_filter(
            $warnings,
            static fn (array $warning): bool => str_contains($warning['message'], 'NULL calendardata skipped'),
        ));
    }

    private function storeNullCalendarData(string $uri): void
    {
        $db = DB::connection('wgw');
        try {
            $updated = $db->table('calendarobjects')->where('uri', $uri)->update(['calendardata' => null]);
        } catch (QueryException) {
            $this->relaxSqliteCalendarDataNullability();
            $updated = $db->table('calendarobjects')->where('uri', $uri)->update(['calendardata' => null]);
        }

        $this->assertSame(1, $updated);
        $this->assertNull($db->table('calendarobjects')->where('uri', $uri)->value('calendardata'));
    }

    /**
     * Sabre's SQLite bundle marks calendardata NOT NULL. MySQL leaves the blob nullable.
     * Rebuild the test table so a NULL row can exist on both drivers.
     */
    private function relaxSqliteCalendarDataNullability(): void
    {
        $db = DB::connection('wgw');
        $this->assertSame('sqlite', $db->getDriverName());

        $row = $db->selectOne("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'calendarobjects'");
        $sql = (string) ($row->sql ?? '');
        $this->assertStringContainsString('calendardata blob NOT NULL', $sql);

        $db->statement('PRAGMA foreign_keys = OFF');
        $db->statement('ALTER TABLE calendarobjects RENAME TO calendarobjects_notnull');
        $db->statement(str_replace('calendardata blob NOT NULL', 'calendardata blob', $sql));
        $db->statement('INSERT INTO calendarobjects SELECT * FROM calendarobjects_notnull');
        $db->statement('DROP TABLE calendarobjects_notnull');
        $db->statement('PRAGMA foreign_keys = ON');
    }
}
