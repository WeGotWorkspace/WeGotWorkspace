<?php

declare(strict_types=1);

namespace App\Services\Jmap\Methods;

use App\Services\Calendars\CalendarEventRepository;
use App\Services\Jmap\JmapAccountStateCodec;
use App\Services\Jmap\JmapCapabilities;
use App\Services\Jmap\JmapMethodException;
use App\Services\Jmap\Methods\Concerns\ValidatesChangesArguments;

/**
 * Calendar/changes: the CalendarEvent/changes fan-out one level up (spec
 * §4), diffing calendar existence and sync tokens instead of event ids.
 *
 * Empirically pinned behavior (JmapChangesTest, documented in
 * docs/calendars/jmap-envelope.md): Sabre bumps a calendar's synctoken on
 * BOTH event changes and pure metadata updates — so renames/recolors ARE
 * reported as `updated`, and event activity over-reports the calendar as
 * `updated` (harmless: clients refetch metadata that didn't change).
 */
final class CalendarChangesMethod implements JmapMethodInterface
{
    use ValidatesChangesArguments;

    public function __construct(private readonly CalendarEventRepository $events) {}

    public function name(): string
    {
        return 'Calendar/changes';
    }

    public function capability(): string
    {
        return JmapCapabilities::CALENDARS;
    }

    public function requiresAccountId(): bool
    {
        return true;
    }

    public function handle(string $username, array $args): array
    {
        $sinceState = $this->sinceState($args);
        $since = JmapAccountStateCodec::decompose($sinceState);
        if ($since === null) {
            throw new JmapMethodException('cannotCalculateChanges', 'Sync state is invalid or expired.');
        }

        $current = $this->events->calendarSyncTokens($username);

        $created = [];
        $updated = [];
        foreach ($current as $uri => $token) {
            if (! array_key_exists($uri, $since)) {
                $created[] = $uri;
            } elseif ($since[$uri] !== $token) {
                $updated[] = $uri;
            }
        }

        $destroyed = [];
        foreach (array_keys($since) as $uri) {
            if (! array_key_exists($uri, $current)) {
                $destroyed[] = $uri;
            }
        }

        return [
            'accountId' => $username,
            'oldState' => $sinceState,
            'newState' => JmapAccountStateCodec::compose($current),
            'hasMoreChanges' => false,
            'created' => $created,
            'updated' => $updated,
            'destroyed' => $destroyed,
        ];
    }
}
