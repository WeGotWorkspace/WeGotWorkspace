<?php

declare(strict_types=1);

namespace App\Services\Notes;

use App\Exceptions\ApiHttpException;
use App\Models\CalendarInstance;
use App\Services\Calendars\CalendarCollectionAccess;

/**
 * Destination handling for notebook delete. Kept out of NotebookRepository so that file stays under 800 lines.
 */
final class NotebookNotesRelocation
{
    public function __construct(
        private readonly NotebookNotesMover $mover,
        private readonly CalendarCollectionAccess $collectionAccess,
    ) {}

    /**
     * @param  array<string, mixed>  $options
     * @param  callable(string): ?CalendarInstance  $findDestination
     */
    public function apply(CalendarInstance $source, array $options, callable $findDestination): void
    {
        $moveNotesTo = $options['moveNotesTo'] ?? null;
        if (! is_string($moveNotesTo) || trim($moveNotesTo) === '') {
            return;
        }

        $destination = $findDestination(trim($moveNotesTo));
        if (! $destination instanceof CalendarInstance) {
            throw new ApiHttpException(404, 'Destination notebook not found.', 'not_found');
        }
        if ((int) $destination->calendarid === (int) $source->calendarid) {
            throw new ApiHttpException(400, 'The destination is the notebook being deleted.', 'bad_request');
        }
        $this->collectionAccess->assertCollectionWritable($destination, 'The destination notebook is read-only.');
        $this->mover->moveAll($source, $destination);
    }
}
