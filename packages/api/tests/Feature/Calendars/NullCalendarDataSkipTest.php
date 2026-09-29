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

        $warnings = [];
        Log::listen(function (MessageLogged $event) use (&$warnings): void {
            if ($event->level === 'warning') {
                $warnings[] = $event->message;
            }
        });

        app(SearchIndexerService::class)->indexCalendarObjectFromPath('calendars/bob/default/'.$uri);
        $fired = app(AlertDueScheduler::class)->scan(new DateTimeImmutable('2026-09-12T12:00:00Z', new DateTimeZone('UTC')));

        $this->assertSame(0, $fired);
        $this->assertSame(
            0,
            SearchDocument::query()
                ->where('source_type', 'caldav')
                ->where('source_key', 'bob|default|'.$uri)
                ->count(),
        );
        $matches = array_values(array_filter(
            $warnings,
            static fn (string $message): bool => str_contains($message, 'null calendardata'),
        ));
        $this->assertGreaterThanOrEqual(2, count($matches));
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
