<?php

declare(strict_types=1);

namespace Tests\Unit\Chat;

use App\Exceptions\ApiHttpException;
use App\Services\Chat\Conversion\ChatMessageJournalConverter;
use DateTimeImmutable;
use DateTimeZone;
use PHPUnit\Framework\TestCase;

/**
 * Round-trip tests for the chat message VJOURNAL mapping (Epic #701, chunk C):
 * UID = client ULID, DESCRIPTION = body, X-WGW-AUTHOR = author principal,
 * RELATED-TO = thread parent, SEQUENCE bumped ONLY on author body edits,
 * STATUS:CANCELLED = delete tombstone, X-WGW-REACTIONS = JSON array.
 */
final class ChatMessageJournalConverterTest extends TestCase
{
    private const ULID = '01J6Y6M0R2V9GKJ4W1T8Q3ZBEX';

    private ChatMessageJournalConverter $converter;

    protected function setUp(): void
    {
        parent::setUp();
        $this->converter = new ChatMessageJournalConverter;
    }

    public function test_round_trip_preserves_all_message_fields(): void
    {
        $createdAt = new DateTimeImmutable('2026-09-04 12:34:56', new DateTimeZone('UTC'));
        $ics = $this->converter->toIcs([
            'id' => self::ULID,
            'body' => "hello *world*\nsecond line, with; specials",
            'author' => 'alice',
            'parentId' => '01J6Y6M0R2V9GKJ4W1T8Q3ZBAA',
        ], $createdAt);

        $message = $this->converter->fromIcs($ics, self::ULID);

        $this->assertSame(self::ULID, $message['id']);
        $this->assertSame("hello *world*\nsecond line, with; specials", $message['body']);
        $this->assertSame('alice', $message['authorId']);
        $this->assertSame('01J6Y6M0R2V9GKJ4W1T8Q3ZBAA', $message['parentId']);
        $this->assertSame('2026-09-04T12:34:56Z', $message['createdAt']);
        $this->assertNull($message['editedAt']);
        $this->assertNull($message['deletedAt']);
        $this->assertSame([], $message['reactions']);
        $this->assertSame(0, $message['sequence']);
    }

    public function test_top_level_message_has_no_parent(): void
    {
        $ics = $this->toIcs(body: 'root message');
        $message = $this->converter->fromIcs($ics, self::ULID);

        $this->assertNull($message['parentId']);
    }

    public function test_ulid_format_is_mandatory_and_normalized_to_uppercase(): void
    {
        $lower = strtolower(self::ULID);
        $this->assertSame(self::ULID, ChatMessageJournalConverter::normalizeUlid($lower));

        $this->expectException(ApiHttpException::class);
        ChatMessageJournalConverter::normalizeUlid('not-a-ulid');
    }

    public function test_edit_bumps_sequence_and_sets_edited_at(): void
    {
        $ics = $this->toIcs(body: 'original');
        $editedAt = new DateTimeImmutable('2026-09-04 13:00:00', new DateTimeZone('UTC'));

        $edited = $this->converter->applyEdit($ics, 'fixed typo', $editedAt);
        $message = $this->converter->fromIcs($edited, self::ULID);

        $this->assertSame('fixed typo', $message['body']);
        $this->assertSame(1, $message['sequence']);
        $this->assertSame('2026-09-04T13:00:00Z', $message['editedAt']);
        // Created stays the create-time DTSTAMP.
        $this->assertSame('2026-09-04T12:34:56Z', $message['createdAt']);
    }

    public function test_tombstone_cancels_clears_body_and_sets_deleted_at(): void
    {
        $ics = $this->toIcs(body: 'delete me');
        $deletedAt = new DateTimeImmutable('2026-09-04 14:00:00', new DateTimeZone('UTC'));

        $tombstoned = $this->converter->applyTombstone($ics, $deletedAt);
        $message = $this->converter->fromIcs($tombstoned, self::ULID);

        $this->assertSame('', $message['body']);
        $this->assertSame('2026-09-04T14:00:00Z', $message['deletedAt']);
        // Tombstoning is not an author body edit: SEQUENCE stays untouched.
        $this->assertSame(0, $message['sequence']);

        // Idempotent: a second tombstone keeps the original deletedAt.
        $again = $this->converter->applyTombstone($tombstoned, new DateTimeImmutable('2026-09-05 09:00:00', new DateTimeZone('UTC')));
        $this->assertSame('2026-09-04T14:00:00Z', $this->converter->fromIcs($again, self::ULID)['deletedAt']);
    }

    public function test_reactions_round_trip_without_touching_sequence(): void
    {
        $ics = $this->toIcs(body: 'react to me');
        $reactions = [
            ['emoji' => '👍', 'authors' => ['alice', 'bob']],
            ['emoji' => '🎉', 'authors' => ['carol']],
        ];

        $withReactions = $this->converter->applyReactions($ics, $reactions);
        $message = $this->converter->fromIcs($withReactions, self::ULID);

        $this->assertSame($reactions, $message['reactions']);
        // Reactions rewrite X-WGW-REACTIONS only — LWW-by-SEQUENCE for edits
        // must never interact with reaction mutations.
        $this->assertSame(0, $message['sequence']);
        $this->assertSame('react to me', $message['body']);

        $cleared = $this->converter->applyReactions($withReactions, []);
        $this->assertSame([], $this->converter->fromIcs($cleared, self::ULID)['reactions']);
    }

    public function test_edit_after_reactions_keeps_reactions_and_bumps_sequence(): void
    {
        $ics = $this->converter->applyReactions($this->toIcs(body: 'v1'), [
            ['emoji' => '👍', 'authors' => ['bob']],
        ]);
        $edited = $this->converter->applyEdit($ics, 'v2', new DateTimeImmutable('now', new DateTimeZone('UTC')));

        $message = $this->converter->fromIcs($edited, self::ULID);
        $this->assertSame('v2', $message['body']);
        $this->assertSame(1, $message['sequence']);
        $this->assertSame([['emoji' => '👍', 'authors' => ['bob']]], $message['reactions']);
    }

    public function test_body_size_limit_is_enforced(): void
    {
        $this->expectException(ApiHttpException::class);
        $this->converter->assertBodySize(str_repeat('x', ChatMessageJournalConverter::MAX_BODY_BYTES + 1));
    }

    private function toIcs(string $body): string
    {
        return $this->converter->toIcs([
            'id' => self::ULID,
            'body' => $body,
            'author' => 'alice',
            'parentId' => null,
        ], new DateTimeImmutable('2026-09-04 12:34:56', new DateTimeZone('UTC')));
    }
}
