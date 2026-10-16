<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use Illuminate\Support\Facades\DB;

/**
 * Removes inbox rows for the retired direct-connect admin notice.
 * Only `rtc.direct_connect` (domain `rtc`, action `direct_connect`).
 */
return new class extends WgwMigration
{
    public function up(): void
    {
        if (! $this->wgwHasTable('notifications')) {
            return;
        }

        $ids = DB::connection('wgw')->table('notifications')
            ->where(function ($query): void {
                $query->where('tag', 'rtc.direct_connect')
                    ->orWhere(function ($inner): void {
                        $inner->where('domain', 'rtc')->where('action', 'direct_connect');
                    });
            })
            ->pluck('id');
        if ($ids->isEmpty()) {
            return;
        }

        if ($this->wgwHasTable('notification_deliveries')) {
            DB::connection('wgw')->table('notification_deliveries')
                ->whereIn('notification_id', $ids->all())
                ->delete();
        }

        DB::connection('wgw')->table('notifications')->whereIn('id', $ids->all())->delete();
    }

    public function down(): void
    {
        // Removed inbox rows are not restored.
    }
};
