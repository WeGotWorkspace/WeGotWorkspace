<?php

declare(strict_types=1);

namespace Tests\Unit\Threads;

use App\Exceptions\ApiHttpException;
use App\Services\Threads\ThreadReactions;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class ThreadReactionsTest extends TestCase
{
    /** @return iterable<string, array{string, bool}> */
    public static function emojiCases(): iterable
    {
        yield 'thumbs up' => ['👍', true];
        yield 'heart with variation selector' => ['❤️', true];
        yield 'skin tone' => ['👍🏽', true];
        yield 'zwj family' => ['👨‍👩‍👧', true];
        yield 'flag' => ['🇳🇱', true];
        yield 'tag flag' => ['🏴󠁧󠁢󠁳󠁣󠁴󠁿', true];
        yield 'keycap' => ['1️⃣', true];
        yield 'three emoji' => ['👍👍👍', true];
        yield 'four emoji' => ['👍👍👍👍', false];
        yield 'letters' => ['ok', false];
        yield 'emoji then letter' => ['👍a', false];
        yield 'html' => ['<img src=x onerror=alert(1)>', false];
        yield 'space' => [' ', false];
        yield 'empty' => ['', false];
        yield 'bare digit' => ['1', false];
        yield 'zwj alone' => ["\u{200D}", false];
    }

    #[DataProvider('emojiCases')]
    public function test_is_emoji(string $value, bool $expected): void
    {
        $this->assertSame($expected, ThreadReactions::isEmoji($value));
    }

    public function test_a_new_non_emoji_is_refused(): void
    {
        $this->expectException(ApiHttpException::class);
        ThreadReactions::toggle([], 'lol', 'alice');
    }

    public function test_a_stored_non_emoji_can_still_be_joined_and_left(): void
    {
        $set = [['emoji' => ':legacy:', 'authors' => ['alice']]];

        $this->assertSame([['emoji' => ':legacy:', 'authors' => ['alice', 'bob']]], ThreadReactions::toggle($set, ':legacy:', 'bob'));
        $this->assertSame([], ThreadReactions::toggle($set, ':legacy:', 'alice'));
    }

    public function test_the_cap_counts_different_emoji(): void
    {
        $set = [];
        foreach (array_slice(['😀', '😁', '😂', '🤣', '😃', '😄', '😅', '😆', '😉', '😊', '😋', '😎', '😍', '😘', '🥰', '😗', '😙', '🥲', '😚', '🙂'], 0, ThreadReactions::MAX_DISTINCT) as $emoji) {
            $set = ThreadReactions::toggle($set, $emoji, 'alice');
        }
        $this->assertCount(ThreadReactions::MAX_DISTINCT, $set);
        $this->assertCount(ThreadReactions::MAX_DISTINCT, ThreadReactions::toggle($set, '😀', 'bob'));

        try {
            ThreadReactions::toggle($set, '🤗', 'bob');
            $this->fail('The 21st emoji should be refused.');
        } catch (ApiHttpException $exception) {
            $this->assertSame(422, $exception->getStatusCode());
        }
    }
}
