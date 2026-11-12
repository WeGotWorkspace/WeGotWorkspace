<?php

declare(strict_types=1);

namespace Tests\Architecture;

use FilesystemIterator;
use PHPUnit\Framework\TestCase;
use RecursiveDirectoryIterator;
use RecursiveIteratorIterator;

/**
 * A `*_failed` log event is an error unless it is listed here with a reason.
 *
 * Rule (see .agents/skills/api/SKILL.md): error = a promised write did not
 * happen, data is now inconsistent, or the install is misconfigured; warning
 * = a designed limit or rejected input, and the system behaved as designed.
 * See https://github.com/WeGotWorkspace/wegotworkspace/issues/1634
 */
final class FailureLogLevelTest extends TestCase
{
    /**
     * Failure events that stay warnings, with the reason.
     *
     * @var array<string, string>
     */
    private const WARNING_FAILURES = [
        // The write falls back to hashing the file like a discovered one.
        'file_node_put_hash_failed' => 'fallback keeps the index correct',
        // One push endpoint failed, often transiently; the sender records it per host.
        'vapid_send_failed' => 'transient, per endpoint',
        // The background sweep sends whatever the deferred send left behind.
        'urgent_push_failed' => 'the sweep retries',
    ];

    public function test_failure_events_log_at_error_unless_listed(): void
    {
        $found = $this->warningFailureEvents();

        $unexpected = array_values(array_diff(array_keys($found), array_keys(self::WARNING_FAILURES)));
        $this->assertSame(
            [],
            $unexpected,
            "These *_failed events log at warning:\n  "
                .implode("\n  ", array_map(static fn (string $key): string => $key.' ('.$found[$key].')', $unexpected))
                ."\nA failed write or out-of-sync side effect logs with Log::error. "
                .'If the system really behaves as designed, add the event to '.self::class.' with a reason.'
        );

        $stale = array_values(array_diff(array_keys(self::WARNING_FAILURES), array_keys($found)));
        $this->assertSame(
            [],
            $stale,
            "These listed events no longer log at warning:\n  ".implode("\n  ", $stale)
                ."\nRemove them from ".self::class.'.'
        );
    }

    /**
     * @return array<string, string> event → first file that logs it at warning
     */
    private function warningFailureEvents(): array
    {
        $root = dirname(__DIR__, 2).'/app';
        $events = [];
        $files = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS));
        foreach ($files as $file) {
            if (! $file->isFile() || $file->getExtension() !== 'php') {
                continue;
            }
            $source = (string) file_get_contents($file->getPathname());
            preg_match_all("/Log::warning\\(\\s*'([a-z0-9_.-]*_failed)'/", $source, $matches);
            foreach ($matches[1] as $event) {
                $events[$event] ??= substr($file->getPathname(), strlen($root) + 1);
            }
        }
        ksort($events);

        return $events;
    }
}
