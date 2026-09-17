<?php

declare(strict_types=1);

namespace Tests\Unit\Docs;

use App\Exceptions\ApiHttpException;
use App\Services\Docs\Conversion\DocsThreadJournalConverter;
use DateTimeImmutable;
use DateTimeZone;
use PHPUnit\Framework\TestCase;

final class DocsThreadJournalConverterTest extends TestCase
{
    private const ULID = '01J6Y6M0R2V9GKJ4W1T8Q3ZBEX';

    private const REPLY = '01J6Y6M0R2V9GKJ4W1T8Q3ZBAA';

    private DocsThreadJournalConverter $converter;

    protected function setUp(): void
    {
        parent::setUp();
        $this->converter = new DocsThreadJournalConverter;
    }

    public function test_comment_root_round_trip_preserves_kind_path_and_anchors(): void
    {
        $ics = $this->converter->toIcs([
            'id' => self::ULID,
            'body' => 'please clarify',
            'author' => 'alice',
            'docPath' => '/users/bob/docs/plan.md',
            'kind' => 'comment',
            'anchorText' => 'Hello world',
            'anchorFrom' => 6,
            'anchorTo' => 11,
            'anchorOccurrence' => 0,
        ], new DateTimeImmutable('2026-09-12 12:34:56', new DateTimeZone('UTC')));

        $message = $this->converter->fromIcs($ics, self::ULID);

        $this->assertSame(self::ULID, $message['id']);
        $this->assertSame('please clarify', $message['body']);
        $this->assertSame('alice', $message['authorId']);
        $this->assertSame('comment', $message['kind']);
        $this->assertSame('/users/bob/docs/plan.md', $message['docPath']);
        $this->assertSame('Hello world', $message['anchorText']);
        $this->assertSame(6, $message['anchorFrom']);
        $this->assertSame(11, $message['anchorTo']);
        $this->assertSame(0, $message['anchorOccurrence']);
        $this->assertNull($message['parentId']);
        $this->assertFalse($message['resolved']);
        $this->assertFalse($message['archived']);
        $this->assertSame('2026-09-12T12:34:56Z', $message['createdAt']);
    }

    public function test_reply_uses_related_to_and_omits_kind(): void
    {
        $ics = $this->converter->toIcs([
            'id' => self::REPLY,
            'body' => 'a reply',
            'author' => 'bob',
            'docPath' => '/users/bob/docs/plan.md',
            'parentId' => self::ULID,
        ], new DateTimeImmutable('2026-09-12 13:00:00', new DateTimeZone('UTC')));

        $message = $this->converter->fromIcs($ics, self::REPLY);

        $this->assertSame(self::ULID, $message['parentId']);
        $this->assertNull($message['kind']);
        $this->assertSame('a reply', $message['body']);
    }

    public function test_suggestion_root_stores_change_id(): void
    {
        $ics = $this->converter->toIcs([
            'id' => self::ULID,
            'body' => 'why this change?',
            'author' => 'alice',
            'docPath' => '/users/bob/docs/plan.md',
            'kind' => 'suggestion',
            'changeId' => 'change-abc',
        ], new DateTimeImmutable('now', new DateTimeZone('UTC')));

        $message = $this->converter->fromIcs($ics, self::ULID);
        $this->assertSame('suggestion', $message['kind']);
        $this->assertSame('change-abc', $message['changeId']);
    }

    public function test_suggestion_root_with_empty_body_round_trips(): void
    {
        $ics = $this->converter->toIcs([
            'id' => self::ULID,
            'body' => '',
            'author' => 'alice',
            'docPath' => '/users/bob/docs/plan.md',
            'kind' => 'suggestion',
            'changeId' => 'change-abc',
        ], new DateTimeImmutable('2026-09-12 12:34:56', new DateTimeZone('UTC')));

        $message = $this->converter->fromIcs($ics, self::ULID);

        $this->assertSame('', $message['body']);
        $this->assertSame('suggestion', $message['kind']);
        $this->assertSame('change-abc', $message['changeId']);
        $this->assertNull($message['parentId']);
    }

    public function test_resolved_and_archived_flags_round_trip(): void
    {
        $ics = $this->converter->toIcs([
            'id' => self::ULID,
            'body' => 'root',
            'author' => 'alice',
            'docPath' => '/users/bob/docs/plan.md',
            'kind' => 'comment',
        ], new DateTimeImmutable('now', new DateTimeZone('UTC')));

        $resolved = $this->converter->fromIcs($this->converter->applyResolved($ics, true), self::ULID);
        $this->assertTrue($resolved['resolved']);

        $archived = $this->converter->fromIcs($this->converter->applyArchived($ics, true), self::ULID);
        $this->assertTrue($archived['archived']);
        $this->assertFalse($archived['resolved']);
    }

    public function test_apply_anchors_round_trip(): void
    {
        $ics = $this->converter->toIcs([
            'id' => self::ULID,
            'body' => '',
            'author' => 'alice',
            'docPath' => '/users/bob/docs/plan.md',
            'kind' => 'suggestion',
            'changeId' => 'change-abc',
        ], new DateTimeImmutable('now', new DateTimeZone('UTC')));

        $updated = $this->converter->fromIcs($this->converter->applyAnchors($ics, [
            'anchorText' => 'Insert hello',
            'anchorFrom' => 12,
            'anchorTo' => 17,
        ]), self::ULID);

        $this->assertSame('Insert hello', $updated['anchorText']);
        $this->assertSame(12, $updated['anchorFrom']);
        $this->assertSame(17, $updated['anchorTo']);
    }

    public function test_reactions_round_trip_on_root(): void
    {
        $ics = $this->converter->toIcs([
            'id' => self::ULID,
            'body' => 'react',
            'author' => 'alice',
            'docPath' => '/users/bob/docs/plan.md',
            'kind' => 'comment',
        ], new DateTimeImmutable('now', new DateTimeZone('UTC')));
        $reactions = [['emoji' => '👍', 'authors' => ['alice', 'bob']]];

        $message = $this->converter->fromIcs($this->converter->applyReactions($ics, $reactions), self::ULID);
        $this->assertSame($reactions, $message['reactions']);
    }

    public function test_ulid_is_mandatory(): void
    {
        $this->expectException(ApiHttpException::class);
        DocsThreadJournalConverter::normalizeUlid('not-a-ulid');
    }
}
