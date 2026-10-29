<?php

declare(strict_types=1);

namespace Tests\Architecture;

use FilesystemIterator;
use PHPUnit\Framework\TestCase;
use RecursiveDirectoryIterator;
use RecursiveIteratorIterator;

/**
 * Ratchet: no new class may copy the CalDAV or CardDAV backend factory.
 *
 * The listed classes each build their own Sabre PDO backend today. #1639
 * replaces those copies with one injected backend. Until then this list may
 * only shrink: a new definition fails, and so does a listed class that no
 * longer defines the method (remove it from the list in the same change).
 */
final class DavBackendCopyAllowlistTest extends TestCase
{
    private const ISSUE = 'https://github.com/WeGotWorkspace/wegotworkspace/issues/1639';

    /** @var list<string> */
    private const CAL_BACKEND_CLASSES = [
        'App\Services\Calendars\CalendarEventMutationSupport',
        'App\Services\Calendars\CalendarRepository',
        'App\Services\Calendars\CalendarSchedulingService',
        'App\Services\Calendars\CalendarShareInvites',
        'App\Services\Calendars\CalendarSubscriptionIcsSync',
        'App\Services\Chat\ChatChangesFeed',
        'App\Services\Chat\ChatChannelRepository',
        'App\Services\Chat\ChatGroupDefaultChannelProvisioner',
        'App\Services\Chat\ChatMessageRepository',
        'App\Services\Docs\DocsThreadPathSync',
        'App\Services\Docs\DocsThreadRepository',
        'App\Services\Notes\NoteCollaborativeWrite',
        'App\Services\Notes\NoteRepository',
        'App\Services\Notes\NotebookRepository',
        'App\Services\Tasks\TaskListRepository',
        'App\Services\Tasks\TaskRepository',
    ];

    /** @var list<string> */
    private const CARD_BACKEND_CLASSES = [
        'App\Services\Contacts\AddressBookRepository',
        'App\Services\Contacts\ContactCardRepository',
    ];

    public function test_no_new_class_defines_cal_backend(): void
    {
        $this->assertOnlyAllowlistedClassesDefine('calBackend', self::CAL_BACKEND_CLASSES);
    }

    public function test_no_new_class_defines_card_backend(): void
    {
        $this->assertOnlyAllowlistedClassesDefine('cardBackend', self::CARD_BACKEND_CLASSES);
    }

    /**
     * @param  list<string>  $allowlist
     */
    private function assertOnlyAllowlistedClassesDefine(string $method, array $allowlist): void
    {
        $defining = $this->classesDefining($method);
        $this->assertNotEmpty($defining, "Expected at least one {$method}() under app/");

        $unexpected = array_values(array_diff($defining, $allowlist));
        $this->assertSame(
            [],
            $unexpected,
            "These classes define {$method}() but are not on the allowlist:\n  "
                .implode("\n  ", $unexpected)
                ."\nDo not copy the DAV backend factory into another class. "
                .'Reuse an existing collaborator or wait for the shared backend; see '.self::ISSUE
        );

        $stale = array_values(array_diff($allowlist, $defining));
        $this->assertSame(
            [],
            $stale,
            "These allowlisted classes no longer define {$method}():\n  "
                .implode("\n  ", $stale)
                ."\nRemove them from ".self::class.' so the list only shrinks; see '.self::ISSUE
        );
    }

    /**
     * @return list<string> class names under app/ (PSR-4 `App\`), sorted
     */
    private function classesDefining(string $method): array
    {
        $appRoot = dirname(__DIR__, 2).'/app';
        $pattern = '/\bfunction\s+'.preg_quote($method, '/').'\s*\(/';
        $classes = [];
        $iterator = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator($appRoot, FilesystemIterator::SKIP_DOTS)
        );

        foreach ($iterator as $file) {
            if (! $file->isFile() || $file->getExtension() !== 'php') {
                continue;
            }
            $source = (string) file_get_contents($file->getPathname());
            if (preg_match($pattern, $source) !== 1) {
                continue;
            }
            $relative = substr($file->getPathname(), strlen($appRoot) + 1, -strlen('.php'));
            $classes[] = 'App\\'.str_replace('/', '\\', $relative);
        }

        sort($classes);

        return $classes;
    }
}
