<?php

declare(strict_types=1);

namespace App\Services\Notify;

use App\Models\Notification;
use App\Models\NotificationMarker;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Per-principal change marker for the inbox: the `Notification` push state
 * (#1660, docs/architecture/jmap-push.md "Inbox: a change marker per principal").
 *
 * {@see Notification} bumps it on every create, update (supersede,
 * read) and delete (clear) of a row, so a writer cannot forget it. A missing
 * row reads as 0. A failed bump is logged, never thrown: it must not undo the
 * inbox write.
 */
final class NotificationInboxMarkers
{
    public function bump(string $principal): void
    {
        $principal = strtolower(trim($principal));
        if ($principal === '') {
            return;
        }
        try {
            NotificationMarker::query()->upsert(
                [['principal' => $principal, 'marker' => 1]],
                ['principal'],
                ['marker' => DB::raw('marker + 1')],
            );
        } catch (\Throwable $e) {
            Log::warning('notification_marker_bump_failed', ['error' => $e->getMessage()]);
        }
    }

    public function markerFor(string $principal): int
    {
        $marker = NotificationMarker::query()
            ->where('principal', strtolower(trim($principal)))
            ->value('marker');

        return $marker === null ? 0 : (int) $marker;
    }
}
