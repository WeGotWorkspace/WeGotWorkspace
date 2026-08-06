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
        $raw = $codec->serialize('Visible', ['planning'], false, 'Hello');
        [$title, $tags, $starred, $body] = $codec->parse($raw, 'fallback');
        $this->assertSame('Visible', $title);
        $this->assertSame(['planning'], $tags);
        $this->assertFalse($starred);
        $this->assertSame('Hello', $body);
    }

    public function test_body_of_returns_only_body_section(): void
    {
        $codec = new NoteMarkdownCodec;
        $raw = $codec->serialize('Title', ['a'], true, "line one\nline two");
        $this->assertSame("line one\nline two", $codec->bodyOf($raw));
    }

    public function test_with_frontmatter_preserves_body(): void
    {
        $codec = new NoteMarkdownCodec;
        $existing = $codec->serialize('Old title', ['old'], false, "kept body\n\nmore");

        $rewritten = $codec->withFrontmatter($existing, 'New title', ['new', 'tags'], true, 'fallback');

        [$title, $tags, $starred, $body] = $codec->parse($rewritten, 'fallback');
        $this->assertSame('New title', $title);
        $this->assertSame(['new', 'tags'], $tags);
        $this->assertTrue($starred);
        $this->assertSame("kept body\n\nmore", $body);
    }

    public function test_with_frontmatter_uses_fallback_when_title_blank(): void
    {
        $codec = new NoteMarkdownCodec;
        $existing = $codec->serialize('Old', [], null, 'body');

        $rewritten = $codec->withFrontmatter($existing, '', [], null, 'note-id');

        [$title] = $codec->parse($rewritten, 'other');
        $this->assertSame('note-id', $title);
    }

    public function test_replace_body_preserves_frontmatter(): void
    {
        $codec = new NoteMarkdownCodec;
        $existing = $codec->serialize('Keep title', ['keep'], true, 'old body');

        $rewritten = $codec->replaceBody($existing, 'fresh body from collab', 'fallback');

        [$title, $tags, $starred, $body] = $codec->parse($rewritten, 'fallback');
        $this->assertSame('Keep title', $title);
        $this->assertSame(['keep'], $tags);
        $this->assertTrue($starred);
        $this->assertSame('fresh body from collab', $body);
    }

    public function test_replace_body_on_bodyless_content_uses_fallback_title(): void
    {
        $codec = new NoteMarkdownCodec;
        // No frontmatter separator: the whole input is treated as body.
        $rewritten = $codec->replaceBody('raw text without frontmatter', 'new body', 'note-id');

        [$title, , , $body] = $codec->parse($rewritten, 'other');
        $this->assertSame('note-id', $title);
        $this->assertSame('new body', $body);
    }

    public function test_list_preview_prefers_body_over_untitled_frontmatter(): void
    {
        $codec = new NoteMarkdownCodec;
        $raw = $codec->serialize('Untitled', [], false, 'Wouter naar Admin');
        $this->assertSame('Wouter naar Admin', $codec->listPreview($raw, 'fallback-id'));
    }

    public function test_list_preview_uses_real_title_when_body_empty(): void
    {
        $codec = new NoteMarkdownCodec;
        $raw = $codec->serialize('Meeting notes', [], false, '');
        $this->assertSame('Meeting notes', $codec->listPreview($raw, 'fallback-id'));
    }

    public function test_list_preview_falls_back_when_untitled_and_empty_body(): void
    {
        $codec = new NoteMarkdownCodec;
        $raw = $codec->serialize('Untitled', [], false, '');
        $this->assertSame('fallback-id', $codec->listPreview($raw, 'fallback-id'));
    }

    public function test_list_preview_strips_task_list_and_common_markdown(): void
    {
        $codec = new NoteMarkdownCodec;
        $body = "Boodschappen Aug\n\n- [ ] Bananen\n- [ ] Fruit\n- [x] Pasta\n\n**bold** and [link](https://example.com)";
        $raw = $codec->serialize('Untitled', [], false, $body);
        $this->assertSame(
            'Boodschappen Aug Bananen Fruit Pasta bold and link',
            $codec->listPreview($raw, 'fallback-id'),
        );
    }

    public function test_serialize_stamps_and_parse_reads_explicit_updated_marker(): void
    {
        $codec = new NoteMarkdownCodec;
        $raw = $codec->serialize('Title', ['a'], false, 'Body', '2024-01-02T03:04:05+00:00');

        $this->assertStringContainsString('updated: 2024-01-02T03:04:05+00:00', $raw);
        $this->assertSame('2024-01-02T03:04:05+00:00', $codec->updatedOf($raw));
        $this->assertSame('2024-01-02T03:04:05+00:00', $codec->parse($raw, 'fallback')[4]);
    }

    public function test_serialize_generates_a_marker_when_none_provided(): void
    {
        $codec = new NoteMarkdownCodec;
        $raw = $codec->serialize('Title', [], null, 'Body');

        $this->assertNotNull($codec->updatedOf($raw));
    }

    public function test_replace_body_preserves_the_metadata_updated_marker(): void
    {
        $codec = new NoteMarkdownCodec;
        $existing = $codec->serialize('Keep', ['keep'], true, 'old body', '2024-05-05T05:05:05+00:00');

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
        $existing = $codec->serialize('Old', ['old'], false, 'body', '2024-01-01T00:00:00+00:00');

        $rewritten = $codec->withFrontmatter($existing, 'New', ['new'], true, 'fallback');

        // A metadata mutation refreshes the marker so LWW state advances.
        $this->assertNotSame('2024-01-01T00:00:00+00:00', $codec->updatedOf($rewritten));
        $this->assertNotNull($codec->updatedOf($rewritten));
    }
}
