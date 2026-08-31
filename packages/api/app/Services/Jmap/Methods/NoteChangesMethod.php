<?php

declare(strict_types=1);

namespace App\Services\Jmap\Methods;

use App\Services\Jmap\JmapAccountStateCodec;
use App\Services\Jmap\JmapCapabilities;
use App\Services\Jmap\JmapMethodException;
use App\Services\Jmap\Methods\Concerns\ValidatesChangesArguments;
use App\Services\Notes\JmapNoteStateService;
use App\Services\Notes\NoteRepository;

/**
 * Account-wide Note/changes fan-out over VJOURNAL notebooks
 * (copy CalendarEventChangesMethod + JmapAccountStateCodec).
 */
final class NoteChangesMethod implements JmapMethodInterface
{
    use ValidatesChangesArguments;

    public function __construct(
        private readonly NoteRepository $notes,
        private readonly JmapNoteStateService $states,
    ) {}

    public function name(): string
    {
        return 'Note/changes';
    }

    public function capability(): string
    {
        return JmapCapabilities::NOTES;
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

        $current = $this->notes->notebookSyncTokens($username);

        $created = [];
        $updated = [];
        $destroyed = [];
        foreach ($current as $uri => $token) {
            if (! array_key_exists($uri, $since)) {
                $delta = $this->notes->changes($username, $uri, null);
                array_push($created, ...$delta['created']);

                continue;
            }
            if ($since[$uri] !== $token) {
                $delta = $this->notes->changes($username, $uri, $since[$uri]);
                array_push($created, ...$delta['created']);
                array_push($updated, ...$delta['updated']);
                array_push($destroyed, ...$delta['destroyed']);
            }
        }

        foreach (array_keys($since) as $uri) {
            if (! array_key_exists($uri, $current)) {
                // Notebook gone: live lookup 404s. Recorded ids survive purge
                // (same as CalendarEventChangesMethod + recordedEventIdsForCalendar).
                array_push($destroyed, ...$this->states->recordedNoteIdsForNotebook($username, $uri));
            }
        }

        $created = array_values(array_unique($created));
        $updated = array_values(array_diff(array_unique($updated), $created));
        $destroyed = array_values(array_diff(array_unique($destroyed), $created, $updated));

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
