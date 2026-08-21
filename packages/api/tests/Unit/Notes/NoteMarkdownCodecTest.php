<?php

declare(strict_types=1);

namespace Tests\Unit\Notes;

use App\Services\Notes\NoteMarkdownCodec;
use PHPUnit\Framework\TestCase;

final class NoteMarkdownCodecTest extends TestCase
{
    public function test_rejects_apple_double_sidecar_filenames(): void
    {
        $codec = new NoteMarkdownCodec;
        $this->assertTrue($codec->isNoteFilename('good.md'));
        $this->assertFalse($codec->isNoteFilename('._good.md'));
    }

    public function test_round_trip_markdown(): void
    {
        $codec = new NoteMarkdownCodec;
        $raw = $codec->serialize('Visible', ['planning'], 'Hello');
        [$title, $tags, $body] = $codec->parse($raw, 'fallback');
        $this->assertSame('Visible', $title);
        $this->assertSame(['planning'], $tags);
        $this->assertSame('Hello', $body);
        $this->assertStringNotContainsString('starred:', $raw);
    }

    public function test_parse_ignores_yaml_starred(): void
    {
        $codec = new NoteMarkdownCodec;
        [$title, $tags, $body] = $codec->parse(
            "title: Visible\ntags: planning\nstarred: true\n----\nHello",
            'fallback',
        );
        $this->assertSame('Visible', $title);
        $this->assertSame(['planning'], $tags);
        $this->assertSame('Hello', $body);
    }

    public function test_body_of_returns_only_body_section(): void
    {
        $codec = new NoteMarkdownCodec;
        $raw = $codec->serialize('Title', ['a'], "line one\nline two");
        $this->assertSame("line one\nline two", $codec->bodyOf($raw));
    }

    public function test_with_frontmatter_preserves_body_and_drops_starred(): void
    {
        $codec = new NoteMarkdownCodec;
        $existing = "title: Old title\ntags: old\nstarred: true\n----\nkept body\n\nmore";

        $rewritten = $codec->withFrontmatter($existing, 'New title', ['new', 'tags'], 'fallback');

        [$title, $tags, $body] = $codec->parse($rewritten, 'fallback');
        $this->assertSame('New title', $title);
        $this->assertSame(['new', 'tags'], $tags);
        $this->assertSame("kept body\n\nmore", $body);
        $this->assertStringNotContainsString('starred:', $rewritten);
    }

    public function test_with_frontmatter_uses_fallback_when_title_blank(): void
    {
        $codec = new NoteMarkdownCodec;
        $existing = $codec->serialize('Old', [], 'body');

        $rewritten = $codec->withFrontmatter($existing, '', [], 'note-id');

        [$title] = $codec->parse($rewritten, 'other');
        $this->assertSame('note-id', $title);
    }

    public function test_replace_body_preserves_frontmatter(): void
    {
        $codec = new NoteMarkdownCodec;
        $existing = $codec->serialize('Keep title', ['keep'], 'old body');

        $rewritten = $codec->replaceBody($existing, 'fresh body from collab', 'fallback');

        [$title, $tags, $body] = $codec->parse($rewritten, 'fallback');
        $this->assertSame('Keep title', $title);
        $this->assertSame(['keep'], $tags);
        $this->assertSame('fresh body from collab', $body);
    }

    public function test_replace_body_on_bodyless_content_uses_fallback_title(): void
    {
        $codec = new NoteMarkdownCodec;
        // No frontmatter separator: the whole input is treated as body.
        $rewritten = $codec->replaceBody('raw text without frontmatter', 'new body', 'note-id');

        [$title, , $body] = $codec->parse($rewritten, 'other');
        $this->assertSame('note-id', $title);
        $this->assertSame('new body', $body);
    }

    public function test_list_preview_prefers_body_over_untitled_frontmatter(): void
    {
        $codec = new NoteMarkdownCodec;
        $raw = $codec->serialize('Untitled', [], 'Wouter naar Admin');
        $this->assertSame('Wouter naar Admin', $codec->listPreview($raw, 'fallback-id'));
    }

    public function test_list_preview_uses_real_title_when_body_empty(): void
    {
        $codec = new NoteMarkdownCodec;
        $raw = $codec->serialize('Meeting notes', [], '');
        $this->assertSame('Meeting notes', $codec->listPreview($raw, 'fallback-id'));
    }

    public function test_list_preview_falls_back_when_untitled_and_empty_body(): void
    {
        $codec = new NoteMarkdownCodec;
        $raw = $codec->serialize('Untitled', [], '');
        // Empty body + Untitled must not surface the note id as the list title.
        $this->assertSame('', $codec->listPreview($raw, 'fallback-id'));
        $this->assertSame(
            '',
            $codec->listPreview(
                $codec->serialize('local-55a6723bcd6e453aa11abf548f043398', [], ''),
                'local-55a6723bcd6e453aa11abf548f043398',
            ),
        );
        $this->assertTrue($codec->isPlaceholderTitle('local-dbac4d6cfb5f48d6866278856920ed5a', 'other-id'));
        $this->assertTrue($codec->isPlaceholderTitle('welcome', 'welcome'));
        $this->assertFalse($codec->isPlaceholderTitle('Meeting notes', 'welcome'));
    }

    public function test_list_preview_strips_task_list_and_common_markdown(): void
    {
        $codec = new NoteMarkdownCodec;
        $body = "Boodschappen Aug\n\n- [ ] Bananen\n- [ ] Fruit\n- [x] Pasta\n\n**bold** and [link](https://example.com)";
        $raw = $codec->serialize('Untitled', [], $body);
        $this->assertSame(
            'Boodschappen Aug Bananen Fruit Pasta bold and link',
            $codec->listPreview($raw, 'fallback-id'),
        );
    }

    public function test_serialize_stamps_and_parse_reads_explicit_updated_marker(): void
    {
        $codec = new NoteMarkdownCodec;
        $raw = $codec->serialize('Title', ['a'], 'Body', '2024-01-02T03:04:05+00:00');

        $this->assertStringContainsString('updated: 2024-01-02T03:04:05+00:00', $raw);
        $this->assertSame('2024-01-02T03:04:05+00:00', $codec->updatedOf($raw));
        $this->assertSame('2024-01-02T03:04:05+00:00', $codec->parse($raw, 'fallback')[3]);
    }

    public function test_serialize_generates_a_marker_when_none_provided(): void
    {
        $codec = new NoteMarkdownCodec;
        $raw = $codec->serialize('Title', [], 'Body');

        $this->assertNotNull($codec->updatedOf($raw));
    }

    public function test_replace_body_preserves_the_metadata_updated_marker(): void
    {
        $codec = new NoteMarkdownCodec;
        $existing = $codec->serialize('Keep', ['keep'], 'old body', '2024-05-05T05:05:05+00:00');

        $rewritten = $codec->replaceBody($existing, 'new collab body', 'fallback');

        // A body-only collab save must NOT advance the metadata marker.
        $this->assertSame('2024-05-05T05:05:05+00:00', $codec->updatedOf($rewritten));
        $this->assertSame('new collab body', $codec->bodyOf($rewritten));
    }

    public function test_replace_body_accepts_an_explicit_preserved_marker(): void
    {
        $codec = new NoteMarkdownCodec;
        // Legacy note with no marker: caller freezes it at the pre-write mtime.
        $existing = "title: Legacy\ntags: \n----\nold body";

        $rewritten = $codec->replaceBody($existing, 'new body', 'fallback', '2020-01-01T00:00:00+00:00');

        $this->assertSame('2020-01-01T00:00:00+00:00', $codec->updatedOf($rewritten));
    }

    public function test_with_frontmatter_bumps_the_updated_marker(): void
    {
        $codec = new NoteMarkdownCodec;
        $existing = $codec->serialize('Old', ['old'], 'body', '2024-01-01T00:00:00+00:00');

        $rewritten = $codec->withFrontmatter($existing, 'New', ['new'], 'fallback');

        // A metadata mutation refreshes the marker so LWW state advances.
        $this->assertNotSame('2024-01-01T00:00:00+00:00', $codec->updatedOf($rewritten));
        $this->assertNotNull($codec->updatedOf($rewritten));
    }
}
