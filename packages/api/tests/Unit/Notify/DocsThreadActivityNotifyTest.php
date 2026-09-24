<?php

declare(strict_types=1);

namespace Tests\Unit\Notify;

use App\Services\Notify\DocsThreadActivityNotify;
use PHPUnit\Framework\TestCase;

final class DocsThreadActivityNotifyTest extends TestCase
{
    public function test_event_data_and_format_copy_for_comment_and_reply(): void
    {
        $data = DocsThreadActivityNotify::eventData(
            'Alice',
            '/users/bob/docs/plan.md',
            'thread-1',
            'msg-1',
            'comment',
            false,
            ['bob'],
            'please clarify',
        );

        $this->assertSame('Alice', $data['actor']);
        $this->assertSame('plan.md', $data['fileName']);
        $this->assertSame('comment', $data['kind']);
        $this->assertFalse($data['isReply']);
        $this->assertSame('/docs?file=users%2Fbob%2Fdocs%2Fplan.md', $data['navigate']);
        $this->assertSame('docs.thread_activity:thread-1', $data['dedupe_key']);
        $this->assertTrue($data['supersede']);

        $copy = DocsThreadActivityNotify::formatCopy($data);
        $this->assertSame('Alice left a comment on plan.md', $copy['title']);
        $this->assertSame('please clarify', $copy['body']);

        $reply = DocsThreadActivityNotify::formatCopy([
            ...$data,
            'isReply' => true,
            'snippet' => 'working on it',
        ]);
        $this->assertSame('Alice replied on plan.md', $reply['title']);
        $this->assertSame('working on it', $reply['body']);
    }

    public function test_suggestion_copy_and_path_owners(): void
    {
        $copy = DocsThreadActivityNotify::formatCopy([
            'actor' => 'Bob',
            'fileName' => 'notes.md',
            'kind' => 'suggestion',
            'isReply' => false,
        ]);
        $this->assertSame('Bob left a suggestion on notes.md', $copy['title']);

        $this->assertSame(['bob'], DocsThreadActivityNotify::pathAclOwnerUsernames('/users/bob/docs/a.md'));
        $this->assertSame([], DocsThreadActivityNotify::pathAclOwnerUsernames('/shared/x.md'));
    }

    public function test_union_recipients_dedupes(): void
    {
        $this->assertSame(
            ['bob', 'alice', 'carol'],
            DocsThreadActivityNotify::unionRecipients(['bob', 'alice'], ['alice'], ['carol', 'bob']),
        );
    }
}
