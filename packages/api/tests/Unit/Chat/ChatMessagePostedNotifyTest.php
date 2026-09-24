<?php

declare(strict_types=1);

namespace Tests\Unit\Chat;

use App\Models\ChatChannelMeta;
use App\Services\Chat\ChatCollectionUris;
use App\Services\Chat\ChatMessagePostedNotify;
use PHPUnit\Framework\TestCase;

final class ChatMessagePostedNotifyTest extends TestCase
{
    public function test_channel_facts_and_formatted_title(): void
    {
        $uri = ChatCollectionUris::channelUri('01h455vb4pa9nnrjpznsav8hva');
        $data = ChatMessagePostedNotify::eventData(
            $uri,
            ChatChannelMeta::KIND_CHANNEL,
            'General',
            'alice',
            'Alice',
            'hello team',
            '01JMSG',
        );

        $this->assertSame('Alice', $data['actor']);
        $this->assertSame('hello team', $data['snippet']);
        $this->assertFalse($data['isDm']);
        $this->assertSame('/meet/channels/01h455vb4pa9nnrjpznsav8hva', $data['navigate']);
        $this->assertSame('chat.message:01JMSG', $data['tag']);
        $this->assertArrayNotHasKey('title', $data);

        $copy = ChatMessagePostedNotify::formatCopy($data);
        $this->assertSame('Alice sent a message in #general', $copy['title']);
        $this->assertSame('hello team', $copy['body']);
    }

    public function test_dm_title_is_author_and_navigate_is_peer_path(): void
    {
        $uri = ChatCollectionUris::dmUri('alice', 'bob');
        $data = ChatMessagePostedNotify::eventData(
            $uri,
            ChatChannelMeta::KIND_DM,
            'Bob',
            'alice',
            'Alice',
            'halo',
            '01JDM',
        );

        $this->assertTrue($data['isDm']);
        $copy = ChatMessagePostedNotify::formatCopy($data);
        $this->assertSame('Alice sent you a direct message', $copy['title']);
        $this->assertSame('halo', $copy['body']);
        $this->assertSame('/meet/dms/alice', $data['navigate']);
    }

    public function test_meeting_kind_uses_meetings_path_and_plain_title(): void
    {
        $uri = ChatCollectionUris::channelUri('standup');
        $data = ChatMessagePostedNotify::eventData(
            $uri,
            ChatChannelMeta::KIND_MEETING,
            'Standup',
            'alice',
            'Alice',
            'starting now',
            '01JMT',
        );

        $copy = ChatMessagePostedNotify::formatCopy($data);
        $this->assertSame('Alice sent a message in Standup', $copy['title']);
        $this->assertSame('starting now', $copy['body']);
        $this->assertSame('/meet/meetings/standup', $data['navigate']);
    }

    public function test_group_default_channel_strips_chat_grp_prefix(): void
    {
        $uri = ChatCollectionUris::groupDefaultUri('devs');
        $path = ChatMessagePostedNotify::navigate($uri, ChatChannelMeta::KIND_CHANNEL, 'alice');
        $this->assertSame('/meet/channels/'.ChatCollectionUris::publicUriSegment($uri), $path);
        $this->assertStringStartsNotWith('/meet/channels/chat-', $path);
    }
}
