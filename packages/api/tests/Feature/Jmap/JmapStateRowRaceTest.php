<?php

declare(strict_types=1);

namespace Tests\Feature\Jmap;

use App\Models\CalendarObject;
use App\Models\Card;
use App\Models\JmapCalendarEventState;
use App\Models\JmapContactState;
use App\Models\JmapNoteState;
use App\Services\Calendars\JmapCalendarEventStateService;
use App\Services\Contacts\JmapContactStateService;
use App\Services\Notes\JmapNoteStateService;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Log\Events\MessageLogged;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Two JMAP requests for the same account can both miss a state row and both insert it
 * (Calendar start-up runs CalendarEvent/query twice at once on a fresh DB). The loser
 * must read the winner's row, not fail the call with serverFail on the UNIQUE key.
 *
 * The race is made deterministic with a query listener: right after our first read of
 * the table misses, it inserts the competing row, exactly where the other request lands.
 */
final class JmapStateRowRaceTest extends WgwDatabaseTestCase
{
    public function test_calendar_event_state_insert_race_returns_the_winning_row(): void
    {
        $object = (new CalendarObject)->forceFill(['uri' => 'race.ics', 'etag' => 'etag-1']);
        $this->insertCompetingRowOnCreate(JmapCalendarEventState::class, [
            'username' => 'bob',
            'event_id' => 'evt-race',
            'calendar_uri' => 'default',
            'object_uri' => 'race.ics',
            'state_token' => 'winnertoken',
            'etag' => 'etag-1',
        ]);

        $event = app(JmapCalendarEventStateService::class)
            ->attachStateToken('bob', ['id' => 'evt-race'], $object, 'default');

        $this->assertSame('winnertoken', $event['state']);
        $this->assertSame(1, JmapCalendarEventState::query()->where('event_id', 'evt-race')->count());
    }

    public function test_contact_state_insert_race_returns_the_winning_row(): void
    {
        $card = (new Card)->forceFill(['uri' => 'race.vcf', 'etag' => 'etag-1']);
        $this->insertCompetingRowOnCreate(JmapContactState::class, [
            'username' => 'bob',
            'card_id' => 'race',
            'address_book_uri' => 'default',
            'card_uri' => 'race.vcf',
            'state_token' => 'winnertoken',
            'etag' => 'etag-1',
        ]);

        $contact = app(JmapContactStateService::class)
            ->attachStateToken('bob', ['id' => 'race'], $card, 'default');

        $this->assertSame('winnertoken', $contact['state']);
        $this->assertSame(1, JmapContactState::query()->where('card_id', 'race')->count());
    }

    public function test_note_state_insert_race_is_not_logged_as_a_failure(): void
    {
        $errors = [];
        Log::listen(static function (MessageLogged $message) use (&$errors): void {
            if ($message->level === 'error') {
                $errors[] = $message->message;
            }
        });
        $this->insertCompetingRowOnCreate(JmapNoteState::class, [
            'username' => 'bob',
            'note_id' => 'note-race',
            'notebook_uri' => 'notes',
            'object_uri' => 'note-race.ics',
        ]);

        app(JmapNoteStateService::class)->remember('bob', 'note-race', 'notes', 'note-race.ics');

        $this->assertSame([], $errors);
        $this->assertSame(1, JmapNoteState::query()->where('note_id', 'note-race')->count());
    }

    public function test_calendar_event_state_second_call_reuses_the_row(): void
    {
        $object = (new CalendarObject)->forceFill(['uri' => 'again.ics', 'etag' => 'etag-1']);
        $service = app(JmapCalendarEventStateService::class);

        $first = $service->attachStateToken('bob', ['id' => 'evt-again'], $object, 'default');
        $second = $service->attachStateToken('bob', ['id' => 'evt-again'], $object, 'default');

        $this->assertSame($first['state'], $second['state']);
        $this->assertSame(1, JmapCalendarEventState::query()->where('event_id', 'evt-again')->count());
    }

    /**
     * Inserts $row once, right after the first SELECT on the model's table: the moment
     * between our read (miss) and our insert in which a concurrent request wins.
     *
     * @param  class-string<JmapCalendarEventState|JmapContactState|JmapNoteState>  $model
     * @param  array<string, string>  $row
     */
    private function insertCompetingRowOnCreate(string $model, array $row): void
    {
        $table = (new $model)->getTable();
        $inserted = false;
        DB::connection('wgw')->listen(static function (QueryExecuted $query) use ($model, $table, $row, &$inserted): void {
            if ($inserted || ! str_starts_with($query->sql, 'select') || ! str_contains($query->sql, $table)) {
                return;
            }
            $inserted = true;
            $model::query()->insert($row + ['created_at' => now(), 'updated_at' => now()]);
        });
    }
}
