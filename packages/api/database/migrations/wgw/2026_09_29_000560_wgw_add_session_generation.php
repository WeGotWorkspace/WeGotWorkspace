<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use Illuminate\Database\Schema\Blueprint;

return new class extends WgwMigration
{
    public function up(): void
    {
        if ($this->wgwHasTable('users') && ! $this->wgwHasColumn('users', 'session_generation')) {
            $this->wgw()->table('users', function (Blueprint $table): void {
                $table->unsignedInteger('session_generation')->default(0);
            });
        }

        if ($this->wgwHasTable('api_refresh_tokens') && ! $this->wgwHasColumn('api_refresh_tokens', 'session_generation')) {
            $this->wgw()->table('api_refresh_tokens', function (Blueprint $table): void {
                $table->unsignedInteger('session_generation')->default(0);
            });
        }
    }

    public function down(): void
    {
        if ($this->wgwHasTable('users') && $this->wgwHasColumn('users', 'session_generation')) {
            $this->wgw()->table('users', function (Blueprint $table): void {
                $table->dropColumn('session_generation');
            });
        }

        if ($this->wgwHasTable('api_refresh_tokens') && $this->wgwHasColumn('api_refresh_tokens', 'session_generation')) {
            $this->wgw()->table('api_refresh_tokens', function (Blueprint $table): void {
                $table->dropColumn('session_generation');
            });
        }
    }
};
