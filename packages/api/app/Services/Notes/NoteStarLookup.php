<?php

declare(strict_types=1);

namespace App\Services\Notes;

use App\Models\NoteStar;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\Log;

/**
 * Which calendar objects a user has starred; a failing `note_stars` table reads as no stars.
 */
final class NoteStarLookup
{
    /**
     * @param  list<int|string>  $objectIds
     * @return array<int, true>
     */
    public static function objectIds(string $username, array $objectIds): array
    {
        if ($objectIds === []) {
            return [];
        }

        try {
            $map = [];
            NoteStar::query()
                ->where('username', $username)
                ->whereIn('calendar_object_id', $objectIds)
                ->pluck('calendar_object_id')
                ->each(function (mixed $id) use (&$map): void {
                    $map[(int) $id] = true;
                });

            return $map;
        } catch (QueryException $exception) {
            self::logFailure($username, $exception);

            return [];
        }
    }

    public static function logFailure(string $username, QueryException $exception): void
    {
        try {
            Log::error('notes_auxiliary_table_failed', [
                'table' => 'note_stars',
                'username' => $username,
                'message' => $exception->getMessage(),
            ]);
        } catch (\Throwable) {
            // Logging is optional outside the Laravel container (e.g. unit tests).
        }
    }
}
