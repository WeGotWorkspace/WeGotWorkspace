<?php

declare(strict_types=1);

namespace App\Services\Jmap\Methods;

use App\Services\Jmap\JmapAccountStateCodec;
use App\Services\Jmap\JmapCapabilities;
use App\Services\Jmap\JmapMethodException;
use App\Services\Jmap\Methods\Concerns\ValidatesChangesArguments;
use App\Services\Notes\NoteRepository;

/**
 * Notebook/changes: existence/token diff via the envelope codec.
 */
final class NotebookChangesMethod implements JmapMethodInterface
{
    use ValidatesChangesArguments;

    public function __construct(private readonly NoteRepository $notes) {}

    public function name(): string
    {
        return 'Notebook/changes';
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
