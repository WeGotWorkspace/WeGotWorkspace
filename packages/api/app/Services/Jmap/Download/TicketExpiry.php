<?php

declare(strict_types=1);

namespace App\Services\Jmap\Download;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Carbon;

/**
 * The download ticket clock (#1500, #1621): a sliding idle expiry capped by
 * an absolute lifetime, both from `wgw.jmap.download_ticket_*`. Used by
 * folder tickets; file tickets keep their own copy until #1622 lands.
 */
final class TicketExpiry
{
    public function expiresAt(Carbon $lastSeen, Carbon $absoluteExpires): Carbon
    {
        $idle = $lastSeen->copy()->addMinutes($this->idleMinutes());

        return $idle->lessThan($absoluteExpires) ? $idle : $absoluteExpires->copy();
    }

    public function absoluteExpiresFrom(Carbon $issuedAt): Carbon
    {
        return $issuedAt->copy()->addHours(max(1, (int) config('wgw.jmap.download_ticket_lifetime_hours', 24)));
    }

    /**
     * Deletes the expired rows of a ticket table with `last_seen_at` and
     * `absolute_expires_at` columns.
     *
     * @template TModel of \Illuminate\Database\Eloquent\Model
     *
     * @param  Builder<TModel>  $tickets
     */
    public function pruneExpired(Builder $tickets): int
    {
        $now = Carbon::now();

        return (int) $tickets
            ->where(function ($query) use ($now): void {
                $query->where('absolute_expires_at', '<=', $now)
                    ->orWhere('last_seen_at', '<=', $now->copy()->subMinutes($this->idleMinutes()));
            })
            ->delete();
    }

    private function idleMinutes(): int
    {
        return max(1, (int) config('wgw.jmap.download_ticket_idle_minutes', 30));
    }
}
