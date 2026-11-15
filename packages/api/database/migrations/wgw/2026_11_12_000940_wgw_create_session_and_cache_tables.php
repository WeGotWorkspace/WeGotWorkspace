<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use Illuminate\Database\Schema\Blueprint;

/**
 * Laravel's own tables, so SESSION_DRIVER=database and CACHE_STORE=database
 * work with SESSION_CONNECTION=wgw and DB_CACHE_CONNECTION=wgw.
 */
return new class extends WgwMigration
{
    public function up(): void
    {
        if (! $this->wgwHasTable('sessions')) {
            $this->wgw()->create('sessions', function (Blueprint $table): void {
                $table->string('id')->primary();
                $table->foreignId('user_id')->nullable()->index();
                $table->string('ip_address', 45)->nullable();
                $table->text('user_agent')->nullable();
                $table->longText('payload');
                $table->integer('last_activity')->index();
            });
        }
        if (! $this->wgwHasTable('cache')) {
            $this->wgw()->create('cache', function (Blueprint $table): void {
                $table->string('key')->primary();
                $table->mediumText('value');
                $table->integer('expiration')->index();
            });
        }
        if (! $this->wgwHasTable('cache_locks')) {
            $this->wgw()->create('cache_locks', function (Blueprint $table): void {
                $table->string('key')->primary();
                $table->string('owner');
                $table->integer('expiration')->index();
            });
        }
    }

    public function down(): void
    {
        $this->wgw()->dropIfExists('cache_locks');
        $this->wgw()->dropIfExists('cache');
        $this->wgw()->dropIfExists('sessions');
    }
};
