<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use Illuminate\Database\Schema\Blueprint;

return new class extends WgwMigration
{
    public function up(): void
    {
        if (! $this->wgwHasTable('api_refresh_tokens') || $this->wgwHasColumn('api_refresh_tokens', 'access_token_epoch')) {
            return;
        }

        $this->wgw()->table('api_refresh_tokens', function (Blueprint $table): void {
            $table->unsignedInteger('access_token_epoch')->default(0);
        });
    }

    public function down(): void
    {
        if (! $this->wgwHasTable('api_refresh_tokens') || ! $this->wgwHasColumn('api_refresh_tokens', 'access_token_epoch')) {
            return;
        }

        $this->wgw()->table('api_refresh_tokens', function (Blueprint $table): void {
            $table->dropColumn('access_token_epoch');
        });
    }
};
