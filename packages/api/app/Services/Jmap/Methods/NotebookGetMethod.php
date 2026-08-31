<?php

declare(strict_types=1);

namespace App\Services\Jmap\Methods;

use App\Services\Jmap\JmapAccountStateCodec;
use App\Services\Jmap\JmapCapabilities;
use App\Services\Jmap\Methods\Concerns\HandlesGetArguments;
use App\Services\Notes\NotebookRepository;
use App\Services\Notes\NoteRepository;

/**
 * Notebook/get over NotebookRepository::list(), with envelope-codec state.
 */
final class NotebookGetMethod implements JmapMethodInterface
{
    use HandlesGetArguments;

    public function __construct(
        private readonly NotebookRepository $notebooks,
        private readonly NoteRepository $notes,
    ) {}

    public function name(): string
    {
        return 'Notebook/get';
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
        $state = JmapAccountStateCodec::compose($this->notes->notebookSyncTokens($username));
        $all = $this->notebooks->list($username)['list'];

        $ids = $this->requestedIds($args);
        $notFound = [];
        if ($ids === null) {
            $this->guardGetAllBound($all);
            $list = $all;
        } else {
            $byId = [];
            foreach ($all as $notebook) {
                $byId[(string) $notebook['id']] = $notebook;
            }
            $list = [];
            foreach ($ids as $id) {
                if (isset($byId[$id])) {
                    $list[] = $byId[$id];
                } else {
                    $notFound[] = $id;
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
