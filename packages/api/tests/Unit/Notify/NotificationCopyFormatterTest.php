<?php

declare(strict_types=1);

namespace Tests\Unit\Notify;

use App\Models\Notification;
use App\Services\Notify\NotificationCopyFormatter;
use PHPUnit\Framework\TestCase;

final class NotificationCopyFormatterTest extends TestCase
{
    public function test_facts_from_event_data_strips_control_keys(): void
    {
        $facts = NotificationCopyFormatter::factsFromEventData([
            'recipients' => ['alice'],
            'actor' => 'Bob',
            'path' => '/users/bob/a.md',
            'fileName' => 'a.md',
            'navigate' => '/docs',
            'tag' => 'docs.shared:1',
            'title' => 'ignore',
            'body' => 'ignore',
            'dedupe_key' => 'x',
            'supersede' => true,
            'trigger' => ['kind' => 'relative'],
        ]);

        $this->assertSame([
            'actor' => 'Bob',
            'path' => '/users/bob/a.md',
            'fileName' => 'a.md',
        ], $facts);
    }

    public function test_legacy_notification_without_data_uses_columns(): void
    {
        $row = new Notification([
            'domain' => 'docs',
            'action' => 'shared',
            'title' => 'Stored title',
            'body' => 'Stored body',
            'data' => null,
        ]);

        $this->assertSame(
            ['title' => 'Stored title', 'body' => 'Stored body'],
            NotificationCopyFormatter::forNotification($row),
        );
    }

    public function test_docs_shared_formats_from_data(): void
    {
        $copy = NotificationCopyFormatter::format('docs', 'shared', [
            'actor' => 'Matthijs',
            'path' => '/users/matthijs/Agenda.md',
            'fileName' => 'Agenda.md',
        ]);

        $this->assertSame('Matthijs shared Agenda.md with you', $copy['title']);
        $this->assertSame('/users/matthijs/Agenda.md', $copy['body']);
    }
}
