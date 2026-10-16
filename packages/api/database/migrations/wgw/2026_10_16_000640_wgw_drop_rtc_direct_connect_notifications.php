<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use Illuminate\Support\Facades\DB;

/**
 * Removes inbox rows for the retired direct-connect admin notice, and drops
 * `rtc_session_metrics`. Nothing writes that table anymore.
 * Notices: only `rtc.direct_connect` (domain `rtc`, action `direct_connect`).
 */
return new class extends WgwMigration
{
    private const DELETE_CHUNK = 500;

    public function up(): void
    {
        $this->deleteDirectConnectNotices();
        $this->wgw()->dropIfExists('rtc_session_metrics');
    }

    public function down(): void
    {
        // Removed inbox rows and the metrics table are not restored.
    }

    private function deleteDirectConnectNotices(): void
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

        foreach ($ids->chunk(self::DELETE_CHUNK) as $chunk) {
            $idList = $chunk->all();
            if ($this->wgwHasTable('notification_deliveries')) {
                DB::connection('wgw')->table('notification_deliveries')
                    ->whereIn('notification_id', $idList)
                    ->delete();
            }

            DB::connection('wgw')->table('notifications')->whereIn('id', $idList)->delete();
        }
    }
};
