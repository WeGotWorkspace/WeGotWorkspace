<?php

declare(strict_types=1);

namespace Tests\Unit\Threads;

use App\Exceptions\ApiHttpException;
use App\Services\Threads\ThreadEntryJournal;
use App\Services\Threads\ThreadReactions;
use DateTimeImmutable;
use DateTimeZone;
use PHPUnit\Framework\TestCase;

/**
 * The shared thread entry core (#2173 chunk A): the parts Chat and Docs used to
 * copy, and that task threads will use as is.
 */
final class ThreadEntryJournalTest extends TestCase
{
    private const ULID = '01J6Y6M0R2V9GKJ4W1T8Q3ZBEX';

    public function test_round_trip_of_a_reply_with_mentions_edit_and_reactions(): void
    {
        $core = new ThreadEntryJournal;
        [$calendar, $journal] = $core->create(strtolower(self::ULID), $this->at('2026-11-18 09:00:00'), 'first', 'alice');
        $this->assertTrue($core->addParent($journal, '01J6Y6M0R2V9GKJ4W1T8Q3ZBF0'));
        $core->addMentions($journal, [['id' => ' Bob ', 'displayName' => ''], ['id' => ' ']]);
        $ics = $core->applyEdit($calendar->serialize(), 'second', $this->at('2026-11-18 09:05:00'));
        $ics = $core->applyReactions($ics, ThreadReactions::toggle([], '👍', 'bob'));

        [, $read] = $core->read($ics);
        $this->assertSame([
            'id' => self::ULID,
            'authorId' => 'alice',
            'body' => 'second',
            'createdAt' => '2026-11-18T09:00:00Z',
            'parentId' => '01J6Y6M0R2V9GKJ4W1T8Q3ZBF0',
        ], $core->baseFields($read, 'fallback'));
        $this->assertSame([['id' => 'bob', 'displayName' => 'bob']], $core->mentionsOf($read));
        $this->assertSame([['emoji' => '👍', 'authors' => ['bob']]], $core->reactionsOf($read));
        $this->assertSame(1, $core->sequenceOf($read));
        $this->assertSame('2026-11-18T09:05:00Z', $core->dateTimeValue($read, 'LAST-MODIFIED'));
    }

    public function test_an_empty_parent_adds_nothing(): void
    {
        $core = new ThreadEntryJournal;
        [, $journal] = $core->create(self::ULID, $this->at('2026-11-18 09:00:00'), 'root', 'alice');

        $this->assertFalse($core->addParent($journal, ''));
        $this->assertFalse($core->addParent($journal, null));
        $this->assertFalse(isset($journal->{'RELATED-TO'}));
    }

    public function test_tombstone_clears_the_body_once(): void
    {
        $core = new ThreadEntryJournal;
        [$calendar] = $core->create(self::ULID, $this->at('2026-11-18 09:00:00'), 'gone soon', 'alice');
        $first = $core->applyTombstone($calendar->serialize(), $this->at('2026-11-18 10:00:00'));

        $this->assertSame($first, $core->applyTombstone($first, $this->at('2026-11-19 10:00:00')));
        [, $journal] = $core->read($first);
        $this->assertTrue($core->isTombstoned($journal));
        $this->assertSame('', $core->baseFields($journal, self::ULID)['body']);
        $this->assertSame('2026-11-18T10:00:00Z', (string) $journal->{'X-WGW-DELETED-AT'});
    }

    public function test_errors_keep_each_domain_wording(): void
    {
        $this->assertError(fn () => ThreadEntryJournal::normalizeUlid('nope', 'Message'), 400, 'Message id must be a ULID.');
        $this->assertError(fn () => ThreadEntryJournal::normalizeUlid('nope', 'Thread'), 400, 'Thread id must be a ULID.');
        $this->assertError(fn () => (new ThreadEntryJournal('Message'))->read('garbage'), 400, 'Invalid message payload.');
        $this->assertError(
            fn () => (new ThreadEntryJournal('Thread'))->read("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n"),
            400,
            'Thread is not a VJOURNAL.',
        );
        $this->assertError(
            fn () => (new ThreadEntryJournal)->create(self::ULID, $this->at('2026-11-18 09:00:00'), str_repeat('x', ThreadEntryJournal::MAX_BODY_BYTES + 1), 'alice'),
            413,
            'Message body exceeds the 64 KiB limit.',
        );
    }

    public function test_reaction_toggle_is_an_or_set_per_person(): void
    {
        $set = ThreadReactions::toggle([], '👍', 'alice');
        $set = ThreadReactions::toggle($set, '🎉', 'bob');
        $set = ThreadReactions::toggle($set, '👍', 'bob');
        $this->assertSame([
            ['emoji' => '👍', 'authors' => ['alice', 'bob']],
            ['emoji' => '🎉', 'authors' => ['bob']],
        ], $set);

        $set = ThreadReactions::toggle($set, '👍', 'alice');
        $set = ThreadReactions::toggle($set, '🎉', 'bob');
        $this->assertSame([['emoji' => '👍', 'authors' => ['bob']]], $set);
    }

    private function at(string $time): DateTimeImmutable
    {
        return new DateTimeImmutable($time, new DateTimeZone('UTC'));
    }

    private function assertError(\Closure $call, int $status, string $message): void
    {
        try {
            $call();
            $this->fail('Expected an ApiHttpException: '.$message);
        } catch (ApiHttpException $e) {
            $this->assertSame($status, $e->getStatusCode());
            $this->assertSame($message, $e->getMessage());
        }
    }
}
