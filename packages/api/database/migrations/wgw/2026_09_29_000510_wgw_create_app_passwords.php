<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use Illuminate\Database\Schema\Blueprint;

return new class extends WgwMigration
{
    public function up(): void
    {
        if ($this->wgwHasTable('wgw_app_passwords')) {
            return;
        }

        $this->wgw()->create('wgw_app_passwords', function (Blueprint $table): void {
            $table->id();
            $table->string('username');
            $table->string('name', 60);
            $table->string('token_hash', 64)->unique();
            $table->timestamp('created_at');
            $table->timestamp('last_used_at')->nullable();
            $table->string('last_used_client', 120)->nullable();
            $table->timestamp('revoked_at')->nullable();
            $table->index(['username', 'token_hash']);
        });
    }

    public function down(): void
    {
        if ($this->wgwHasTable('wgw_app_passwords')) {
            $this->wgw()->drop('wgw_app_passwords');
        }
    }
};
