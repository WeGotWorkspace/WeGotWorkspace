<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use Illuminate\Database\Schema\Blueprint;

/**
 * App scopes a push subscription was posted from (#1606), space-separated.
 * Null is "unknown" and receives every notification, so existing rows keep
 * today's behaviour until their app posts a scope.
 */
return new class extends WgwMigration
{
    public function up(): void
    {
        if (! $this->wgwHasTable('push_subscriptions') || $this->wgwHasColumn('push_subscriptions', 'scopes')) {
            return;
        }

        $this->wgw()->table('push_subscriptions', function (Blueprint $table): void {
            $table->string('scopes', 255)->nullable();
        });
    }

    public function down(): void
    {
        if (! $this->wgwHasTable('push_subscriptions') || ! $this->wgwHasColumn('push_subscriptions', 'scopes')) {
            return;
        }

        $this->wgw()->table('push_subscriptions', function (Blueprint $table): void {
            $table->dropColumn('scopes');
        });
    }
};
