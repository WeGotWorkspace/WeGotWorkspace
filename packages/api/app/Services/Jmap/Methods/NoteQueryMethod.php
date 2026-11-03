<?php

declare(strict_types=1);

namespace App\Services\Jmap\Methods;

use App\Services\Calendars\JournalObjectIds;
use App\Services\Jmap\JmapAccountStateCodec;
use App\Services\Jmap\JmapCapabilities;
use App\Services\Jmap\JmapMethodException;
use App\Services\Jmap\Methods\Concerns\HandlesQueryArguments;
use App\Services\Notes\NotebookRepository;

/**
 * Note/query (RFC 8620 §5.5): note ids across the notebooks Note/get
 * enumerates, without loading bodies, so a client can list more notes than
 * maxObjectsInGet and fetch them with explicit ids (#1792).
 *
 * Supports `inNotebook`; ids are ordered by notebook, then by storage order.
 * queryState is the Note/get state.
 */
final class NoteQueryMethod implements JmapMethodInterface
{
    use HandlesQueryArguments;

    public function __construct(
        private readonly NotebookRepository $notebooks,
        private readonly JournalObjectIds $journalIds,
    ) {}

    public function name(): string
    {
        return 'Note/query';
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
        $filter = $this->queryFilter($args, ['inNotebook']);
        $this->rejectQuerySort($args);
        [$position, $limit] = $this->queryWindowArguments($args);

        $tokens = $this->notebooks->notebookSyncTokens($username);
        $notebookIds = array_keys($tokens);
        if (array_key_exists('inNotebook', $filter)) {
            $inNotebook = $filter['inNotebook'];
            if (! is_string($inNotebook) || $inNotebook === '') {
                throw new JmapMethodException('invalidArguments', 'filter.inNotebook must be a non-empty id.');
            }
            // A notebook the caller cannot reach matches nothing.
            $notebookIds = array_key_exists($inNotebook, $tokens) ? [$inNotebook] : [];
        }

        $ids = [];
        foreach ($notebookIds as $notebookId) {
            $instance = $this->notebooks->findAccessibleNotebook($username, (string) $notebookId);
            if ($instance === null) {
                continue;
            }
            array_push($ids, ...$this->journalIds->inCalendar((int) $instance->calendarid));
        }

        return $this->queryResponse(
            $username,
            JmapAccountStateCodec::compose($tokens),
            array_values(array_unique($ids)),
            $position,
            $limit,
        );
    }
}
