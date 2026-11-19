<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use Illuminate\Database\Schema\Blueprint;

/**
 * Named app passwords for DAV and Meet Basic sign-in (#2271), and the last time
 * a DAV or Meet client signed in with the account password instead. Only the
 * sha256 of an app password is stored; the lookup is one indexed equality.
 */
return new class extends WgwMigration
{
    public function up(): void
    {
        if (! $this->wgwHasTable('app_passwords')) {
            $this->wgw()->create('app_passwords', function (Blueprint $table): void {
                $table->id();
                $table->string('username', 255);
                $table->string('name', 60);
                $table->char('token_hash', 64)->unique();
                $table->timestamp('created_at')->nullable();
                $table->timestamp('last_used_at')->nullable();
                $table->string('last_used_client', 120)->nullable();
                $table->timestamp('revoked_at')->nullable();
                $table->index(['username', 'revoked_at']);
            });
        }

        if ($this->wgwHasTable('users') && ! $this->wgwHasColumn('users', 'dav_password_used_at')) {
            $this->wgw()->table('users', function (Blueprint $table): void {
                $table->timestamp('dav_password_used_at')->nullable();
            });
        }
    }

    public function down(): void
    {
        $this->wgw()->dropIfExists('app_passwords');

        if ($this->wgwHasTable('users') && $this->wgwHasColumn('users', 'dav_password_used_at')) {
            $this->wgw()->table('users', function (Blueprint $table): void {
                $table->dropColumn('dav_password_used_at');
            });
        }
    }
};
