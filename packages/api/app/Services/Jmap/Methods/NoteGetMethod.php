<?php

declare(strict_types=1);

namespace App\Services\Jmap\Methods;

use App\Exceptions\ApiHttpException;
use App\Services\Jmap\JmapAccountStateCodec;
use App\Services\Jmap\JmapCapabilities;
use App\Services\Jmap\Methods\Concerns\HandlesGetArguments;
use App\Services\Notes\NoteRepository;

/**
 * Note/get: ids loop via NoteRepository::show(); ids null enumerates all notebooks.
 */
final class NoteGetMethod implements JmapMethodInterface
{
    use HandlesGetArguments;

    public function __construct(private readonly NoteRepository $notes) {}

    public function name(): string
    {
        return 'Note/get';
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
        $tokens = $this->notes->notebookSyncTokens($username);
        $state = JmapAccountStateCodec::compose($tokens);

        $ids = $this->requestedIds($args);
        $list = [];
        $notFound = [];
        if ($ids === null) {
            foreach (array_keys($tokens) as $notebookId) {
                foreach ($this->notes->list($username, $notebookId, null, null)['list'] as $note) {
                    $list[] = $note;
                }
            }
            $this->guardGetAllBound($list);
        } else {
            foreach ($ids as $id) {
                try {
                    $list[] = $this->notes->show($username, $id);
                } catch (ApiHttpException $e) {
                    if ($e->getStatusCode() === 404) {
                        $notFound[] = $id;

                        continue;
                    }
                    throw $e;
                }
            }
        }

        return [
            'accountId' => $username,
            'state' => $state,
            'list' => $this->projectProperties($list, $args),
            'notFound' => $notFound,
        ];
    }
}
