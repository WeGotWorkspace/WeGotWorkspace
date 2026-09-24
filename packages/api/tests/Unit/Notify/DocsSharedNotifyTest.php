<?php

declare(strict_types=1);

namespace Tests\Unit\Notify;

use App\Services\Notify\DocsSharedNotify;
use PHPUnit\Framework\TestCase;

final class DocsSharedNotifyTest extends TestCase
{
    public function test_markdown_share_stores_facts_and_formats_copy(): void
    {
        $data = DocsSharedNotify::eventData('bob', '/users/bob/notes.md', 'share-1');

        $this->assertSame('bob', $data['actor']);
        $this->assertSame('/users/bob/notes.md', $data['path']);
        $this->assertSame('notes.md', $data['fileName']);
        $this->assertSame('/docs', $data['navigate']);
        $this->assertSame('docs.shared:share-1', $data['tag']);
        $this->assertArrayNotHasKey('title', $data);

        $copy = DocsSharedNotify::formatCopy($data);
        $this->assertSame('bob shared notes.md with you', $copy['title']);
        $this->assertSame('/users/bob/notes.md', $copy['body']);
    }

    public function test_non_markdown_share_navigates_to_drive(): void
    {
        $data = DocsSharedNotify::eventData('alice', '/users/alice/deck.pdf', 'share-2');

        $this->assertSame('deck.pdf', $data['fileName']);
        $this->assertSame('/drive', $data['navigate']);
        $this->assertSame('alice shared deck.pdf with you', DocsSharedNotify::formatCopy($data)['title']);
    }

    public function test_basename_only_path_omits_subtitle(): void
    {
        $this->assertNull(DocsSharedNotify::pathSubtitle('notes.md', 'notes.md'));
        $this->assertSame('/users/bob/notes.md', DocsSharedNotify::pathSubtitle('/users/bob/notes.md', 'notes.md'));
    }
}
