<?php

declare(strict_types=1);

namespace Tests\Unit\Chat;

use App\Services\Chat\ChatCollectionUris;
use PHPUnit\Framework\TestCase;

final class ChatCollectionUrisTest extends TestCase
{
    public function test_public_uri_segment_strips_chat_prefixes(): void
    {
        $this->assertSame(
            '01h455vb4pa9nnrjpznsav8hva',
            ChatCollectionUris::publicUriSegment('chat-01h455vb4pa9nnrjpznsav8hva'),
        );
        $hash = substr(hash('sha256', "group-default\ndevs"), 0, 40);
        $this->assertSame($hash, ChatCollectionUris::publicUriSegment(ChatCollectionUris::groupDefaultUri('devs')));
        $this->assertSame('already-public', ChatCollectionUris::publicUriSegment('already-public'));
    }
}
