<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use Illuminate\Database\Schema\Blueprint;

/**
 * Web Push status per subscription (#1670). A `vapid` delivery row with an
 * endpoint hash records that its notification reached that subscription, so
 * the sweep never sends it there again. `local` rows keep a null hash.
 */
return new class extends WgwMigration
{
    public function up(): void
    {
        if (! $this->wgwHasTable('notification_deliveries') || $this->wgwHasColumn('notification_deliveries', 'endpoint_hash')) {
            return;
        }

        $this->wgw()->table('notification_deliveries', function (Blueprint $table): void {
            $table->string('endpoint_hash', 64)->nullable();
            $table->index(['notification_id', 'channel'], 'notification_deliveries_notification_channel_index');
        });
    }

    public function down(): void
    {
        if (! $this->wgwHasTable('notification_deliveries') || ! $this->wgwHasColumn('notification_deliveries', 'endpoint_hash')) {
            return;
        }

        $this->wgw()->table('notification_deliveries', function (Blueprint $table): void {
            $table->dropIndex('notification_deliveries_notification_channel_index');
            $table->dropColumn('endpoint_hash');
        });
    }
};
