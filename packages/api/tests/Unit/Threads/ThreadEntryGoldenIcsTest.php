<?php

declare(strict_types=1);

namespace Tests\Unit\Threads;

use App\Services\Chat\Conversion\ChatMessageJournalConverter;
use App\Services\Docs\Conversion\DocsThreadJournalConverter;
use DateTimeImmutable;
use DateTimeZone;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * Pins the exact ICS that Chat and Docs store, and what they read back from it
 * (#2173 chunk A). The fixtures were written by the converters before they
 * moved onto the shared thread module, so any byte that changes on the wire
 * fails here. Only the PRODID line is normalised: it carries the sabre/vobject
 * version, which a dependency bump may change.
 *
 * Regenerate only on purpose: WGW_GOLDEN_UPDATE=1 vendor/bin/phpunit tests/Unit/Threads/ThreadEntryGoldenIcsTest.php
 */
final class ThreadEntryGoldenIcsTest extends TestCase
{
    private const FIXTURES = __DIR__.'/../../fixtures/Threads';

    private const ROOT = '01J6Y6M0R2V9GKJ4W1T8Q3ZBEX';

    private const REPLY = '01J6Y6M0R2V9GKJ4W1T8Q3ZBF0';

    private const BODY = "hello *world* — ünïcode 🎉\nsecond line, with; specials: \\ and a very long line that has to be folded by the serializer because it runs past seventy-five octets";

    /**
     * @return array<string, array{0: \Closure(): string, 1: \Closure(string): array<string, mixed>}>
     */
    public static function cases(): array
    {
        $created = new DateTimeImmutable('2026-09-04 12:34:56', new DateTimeZone('Europe/Amsterdam'));
        $later = new DateTimeImmutable('2026-09-05 08:00:01', new DateTimeZone('UTC'));
        $chat = static fn (): ChatMessageJournalConverter => new ChatMessageJournalConverter;
        $docs = static fn (): DocsThreadJournalConverter => new DocsThreadJournalConverter;
        $chatRead = static fn (string $ics): array => $chat()->fromIcs($ics, self::ROOT);
        $docsRead = static fn (string $ics): array => $docs()->fromIcs($ics, self::ROOT);

        $chatComment = static fn (): string => $chat()->toIcs([
            'id' => strtolower(self::ROOT),
            'body' => self::BODY,
            'author' => 'alice',
            'mentions' => [
                ['id' => ' Bob ', 'displayName' => ' Bob Builder '],
                ['id' => 'carol'],
                ['id' => '  '],
                ['id' => 'dave', 'displayName' => ''],
            ],
        ], $created);
        $chatReply = static fn (): string => $chat()->toIcs([
            'id' => self::REPLY,
            'body' => 'a reply',
            'author' => 'bob',
            'parentId' => strtolower(self::ROOT),
        ], $created);
        $chatEdited = static fn (): string => $chat()->applyEdit($chatComment(), 'edited body', $later);
        $chatEditedTwice = static fn (): string => $chat()->applyEdit($chatEdited(), 'edited again', $later->modify('+1 minute'));
        $chatReacted = static fn (): string => $chat()->applyReactions($chatEdited(), [
            ['emoji' => '👍', 'authors' => ['alice', 'bob']],
            ['emoji' => '🎉', 'authors' => ['carol']],
        ]);
        $chatTombstone = static fn (): string => $chat()->applyTombstone($chatReacted(), $later);
        $chatTombstoneTwice = static fn (): string => $chat()->applyTombstone($chatTombstone(), $later->modify('+1 day'));
        $chatReactionsCleared = static fn (): string => $chat()->applyReactions($chatReacted(), []);

        $docsComment = static fn (): string => $docs()->toIcs([
            'id' => self::ROOT,
            'body' => self::BODY,
            'author' => 'alice',
            'docPath' => 'Documents/Plan; v2.md',
            'anchorText' => 'the quoted, text',
            'anchorFrom' => 12,
            'anchorTo' => 40,
            'anchorOccurrence' => 2,
        ], $created);
        $docsSuggestion = static fn (): string => $docs()->toIcs([
            'id' => self::ROOT,
            'body' => 'replace this',
            'author' => 'alice',
            'docPath' => 'Documents/Plan.md',
            'kind' => DocsThreadJournalConverter::KIND_SUGGESTION,
            'changeId' => 'change-42',
        ], $created);
        $docsReply = static fn (): string => $docs()->toIcs([
            'id' => self::REPLY,
            'body' => 'a reply',
            'author' => 'bob',
            'docPath' => 'Documents/Plan.md',
            'parentId' => strtolower(self::ROOT),
        ], $created);
        $docsReacted = static fn (): string => $docs()->applyReactions($docsComment(), [
            ['emoji' => '👍', 'authors' => ['alice', 'bob']],
        ]);
        $docsResolved = static fn (): string => $docs()->applyResolved($docsReacted(), true);
        $docsArchived = static fn (): string => $docs()->applyArchived($docsSuggestion(), true);
        $docsAnchors = static fn (): string => $docs()->applyAnchors($docsComment(), ['anchorText' => 'new text', 'anchorFrom' => 1, 'anchorTo' => 9]);
        $docsMoved = static fn (): string => $docs()->applyDocPath($docsComment(), 'Archive/Plan.md');

        return [
            'chat-comment' => [$chatComment, $chatRead],
            'chat-reply' => [$chatReply, $chatRead],
            'chat-edited' => [$chatEdited, $chatRead],
            'chat-edited-twice' => [$chatEditedTwice, $chatRead],
            'chat-reacted' => [$chatReacted, $chatRead],
            'chat-reactions-cleared' => [$chatReactionsCleared, $chatRead],
            'chat-tombstone' => [$chatTombstone, $chatRead],
            'chat-tombstone-twice' => [$chatTombstoneTwice, $chatRead],
            'docs-comment' => [$docsComment, $docsRead],
            'docs-suggestion' => [$docsSuggestion, $docsRead],
            'docs-reply' => [$docsReply, $docsRead],
            'docs-reacted' => [$docsReacted, $docsRead],
            'docs-resolved' => [$docsResolved, $docsRead],
            'docs-archived' => [$docsArchived, $docsRead],
            'docs-anchors' => [$docsAnchors, $docsRead],
            'docs-moved' => [$docsMoved, $docsRead],
        ];
    }

    /**
     * @param  \Closure(): string  $write
     * @param  \Closure(string): array<string, mixed>  $read
     */
    #[DataProvider('cases')]
    public function test_chat_and_docs_bytes_unchanged(\Closure $write, \Closure $read): void
    {
        $name = (string) $this->dataName();
        $ics = $this->normaliseProdId($write());
        $parsed = json_encode($read($ics), JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)."\n";

        $icsPath = self::FIXTURES.'/'.$name.'.ics';
        $jsonPath = self::FIXTURES.'/'.$name.'.json';
        if (getenv('WGW_GOLDEN_UPDATE') === '1') {
            @mkdir(self::FIXTURES, 0777, true);
            file_put_contents($icsPath, $ics);
            file_put_contents($jsonPath, $parsed);
        }

        $this->assertFileExists($icsPath);
        $this->assertSame((string) file_get_contents($icsPath), $ics, $name.': stored ICS changed');
        $this->assertSame((string) file_get_contents($jsonPath), $parsed, $name.': parsed entry changed');
    }

    private function normaliseProdId(string $ics): string
    {
        return (string) preg_replace('/^PRODID:[^\r\n]*\r\n/m', "PRODID:<sabre-vobject>\r\n", $ics, 1);
    }
}
