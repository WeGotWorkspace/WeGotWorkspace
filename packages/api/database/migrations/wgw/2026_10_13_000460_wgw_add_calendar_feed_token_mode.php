<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use Illuminate\Database\Schema\Blueprint;

return new class extends WgwMigration
{
    public function up(): void
    {
        if (! $this->wgwHasTable('calendar_feed_tokens') || $this->wgwHasColumn('calendar_feed_tokens', 'mode')) {
            return;
        }

        $this->wgw()->table('calendar_feed_tokens', function (Blueprint $table): void {
            $table->string('mode', 16)->default('full');
        });
    }

    public function down(): void
    {
        if (! $this->wgwHasTable('calendar_feed_tokens') || ! $this->wgwHasColumn('calendar_feed_tokens', 'mode')) {
            return;
        }

        $this->wgw()->table('calendar_feed_tokens', function (Blueprint $table): void {
            $table->dropColumn('mode');
        });
    }
};
