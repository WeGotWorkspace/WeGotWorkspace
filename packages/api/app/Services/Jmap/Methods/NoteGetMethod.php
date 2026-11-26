<?php

declare(strict_types=1);

namespace App\Services\Jmap\Methods;

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

    public static function name(): string
    {
        return 'Note/get';
    }

    public static function capability(): string
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

        $projection = $this->getProjection($args);
        $ids = $this->requestedIds($args);
        $list = [];
        $notFound = [];
        if ($ids === null) {
            foreach (array_keys($tokens) as $notebookId) {
                foreach ($this->notes->list($username, $notebookId, null, null)['list'] as $note) {
                    $list[] = $projection->apply($note);
                }
            }
            $this->guardGetAllBound($list);
        } else {
            foreach ($this->notes->showEach($username, $ids) as $id => $note) {
                if ($note === null) {
                    $notFound[] = $id;

                    continue;
                }
                $list[] = $projection->apply($note);
            }
        }

        return [
            'accountId' => $username,
            'state' => $state,
            'list' => $list,
            'notFound' => $notFound,
        ];
    }
}
