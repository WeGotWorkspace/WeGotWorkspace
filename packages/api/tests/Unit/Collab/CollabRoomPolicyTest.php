<?php

declare(strict_types=1);

namespace Tests\Unit\Collab;

use App\Services\Collab\CollabResponseException;
use App\Services\Collab\CollabRoomPolicy;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

final class CollabRoomPolicyTest extends TestCase
{
    /**
     * @return array<string, array{string}>
     */
    public static function acceptedDocumentPathProvider(): array
    {
        return [
            'parentheses' => ['users/alice/docs/Offerte (v2).md'],
            'accents' => ['users/alice/docs/Café notities.md'],
            'ampersand in a directory' => ['users/alice/Klanten & partners/plan.md'],
            '250 characters' => [self::pathOfLength(250)],
        ];
    }

    #[DataProvider('acceptedDocumentPathProvider')]
    public function test_accepts_document_paths_with_accents_parentheses_and_ampersands(string $path): void
    {
        $policy = new CollabRoomPolicy;

        $this->assertSame($path, $policy->cleanRoom($path));
        $this->assertSame($path, $policy->cleanDocumentPath($path));
    }

    #[DataProvider('acceptedDocumentPathProvider')]
    public function test_leading_slashes_are_stripped_to_the_canonical_room(string $path): void
    {
        $policy = new CollabRoomPolicy;

        $this->assertSame($path, $policy->cleanRoom('/'.$path));
        $this->assertSame($path, $policy->cleanDocumentPath('//'.$path));
    }

    public function test_accepts_a_note_uid_without_a_slash(): void
    {
        $policy = new CollabRoomPolicy;
        $uid = 'urn:uuid:550e8400-e29b-41d4-a716-446655440000';

        $this->assertSame($uid, $policy->cleanRoom($uid));
    }

    public function test_accepts_a_path_of_exactly_1024_characters(): void
    {
        $policy = new CollabRoomPolicy;
        $path = self::pathOfLength(1024);
        $this->assertSame(1024, mb_strlen($path));

        $this->assertSame($path, $policy->cleanDocumentPath($path));
    }

    public function test_counts_length_in_characters_not_bytes(): void
    {
        $policy = new CollabRoomPolicy;
        // 1024 multibyte characters: 1021 bytes of prefix would already blow a byte limit.
        $path = 'users/alice/'.str_repeat('é', 1024 - 12 - 3).'.md';
        $this->assertSame(1024, mb_strlen($path));

        $this->assertSame($path, $policy->cleanDocumentPath($path));
    }

    /**
     * @return array<string, array{string}>
     */
    public static function rejectedRoomProvider(): array
    {
        return [
            'empty' => [''],
            'only slashes' => ['///'],
            'parent segment' => ['users/alice/../bob/plan.md'],
            'leading parent segment' => ['../etc/passwd.md'],
            'trailing parent segment' => ['users/alice/..'],
            'current segment' => ['users/./alice/plan.md'],
            'empty inner segment' => ['users/alice//plan.md'],
            'trailing slash' => ['users/alice/docs/'],
            'null byte' => ["users/alice/pl\x00an.md"],
            'newline' => ["users/alice/pl\nan.md"],
            'delete control character' => ["users/alice/pl\x7fan.md"],
            'backslash' => ['users\\alice\\plan.md'],
            'untrimmed' => [' users/alice/plan.md '],
            'invalid utf8' => ["users/alice/pl\xc3\x28n.md"],
            'too long' => [self::pathOfLength(1025)],
        ];
    }

    #[DataProvider('rejectedRoomProvider')]
    public function test_rejects_unsafe_or_denormalized_rooms(string $room): void
    {
        $policy = new CollabRoomPolicy;

        try {
            $policy->cleanRoom($room);
            $this->fail('Expected '.CollabResponseException::class.' for room: '.$room);
        } catch (CollabResponseException $exception) {
            $this->assertSame(400, $exception->status);
            $this->assertSame('invalid_room', $exception->payload['error']);
        }
    }

    public function test_rejects_a_non_string_room(): void
    {
        $policy = new CollabRoomPolicy;

        $this->expectException(CollabResponseException::class);
        $policy->cleanRoom(['users/alice/plan.md']);
    }

    /**
     * @return list<array{string}>
     */
    public static function documentExtensionProvider(): array
    {
        return [
            ['csv'], ['env'], ['html'], ['ini'], ['json'], ['log'],
            ['md'], ['markdown'], ['toml'], ['txt'], ['xml'], ['yaml'], ['yml'],
        ];
    }

    #[DataProvider('documentExtensionProvider')]
    public function test_document_extension_allowlist_is_unchanged(string $extension): void
    {
        $policy = new CollabRoomPolicy;
        $path = 'users/alice/docs/Café (v2).'.$extension;

        $this->assertSame($path, $policy->cleanDocumentPath($path));
    }

    public function test_rejects_a_document_path_outside_the_extension_allowlist(): void
    {
        $policy = new CollabRoomPolicy;

        try {
            $policy->cleanDocumentPath('users/alice/docs/Café notities.png');
            $this->fail('Expected '.CollabResponseException::class.' for a binary extension.');
        } catch (CollabResponseException $exception) {
            $this->assertSame(400, $exception->status);
            $this->assertSame('invalid_document_path', $exception->payload['error']);
        }
    }

    public function test_room_key_is_the_sha1_of_the_canonical_room(): void
    {
        $policy = new CollabRoomPolicy;
        $path = 'users/alice/docs/Café notities.md';

        $key = $policy->roomKey($path);
        $this->assertSame(sha1($path), $key);
        $this->assertMatchesRegularExpression('/^[a-f0-9]{40}$/', $key);
    }

    public function test_room_key_is_stable_across_leading_slash_variants(): void
    {
        $policy = new CollabRoomPolicy;
        $path = 'users/alice/Klanten & partners/plan.md';

        $this->assertSame(
            $policy->roomKey($policy->cleanRoom($path)),
            $policy->roomKey($policy->cleanRoom('/'.$path)),
        );
    }

    public function test_room_key_separates_distinct_paths(): void
    {
        $policy = new CollabRoomPolicy;

        $this->assertNotSame(
            $policy->roomKey('users/alice/docs/Café notities.md'),
            $policy->roomKey('users/alice/docs/Cafe notities.md'),
        );
    }

    private static function pathOfLength(int $length): string
    {
        $prefix = 'users/alice/docs/';
        $suffix = '.md';

        return $prefix.str_repeat('a', $length - mb_strlen($prefix) - mb_strlen($suffix)).$suffix;
    }
}
