<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use Illuminate\Database\Schema\Blueprint;

/**
 * Two-factor sign-in (#2273): the authenticator of a user, their recovery
 * codes, and the short-lived challenges between the password and the code.
 * Secrets are stored with Laravel's `encrypted` cast; codes and challenge ids
 * only as sha256.
 */
return new class extends WgwMigration
{
    public function up(): void
    {
        if (! $this->wgwHasTable('user_mfa')) {
            $this->wgw()->create('user_mfa', function (Blueprint $table): void {
                $table->id();
                $table->string('username', 255)->unique();
                $table->text('totp_secret');
                $table->timestamp('enabled_at')->nullable();
                $table->unsignedBigInteger('last_used_step')->nullable();
                $table->timestamps();
            });
        }

        if (! $this->wgwHasTable('mfa_recovery_codes')) {
            $this->wgw()->create('mfa_recovery_codes', function (Blueprint $table): void {
                $table->id();
                $table->string('username', 255);
                $table->char('code_hash', 64);
                $table->timestamp('created_at')->nullable();
                $table->timestamp('used_at')->nullable();
                $table->unique(['username', 'code_hash']);
            });
        }

        if (! $this->wgwHasTable('auth_challenges')) {
            $this->wgw()->create('auth_challenges', function (Blueprint $table): void {
                $table->id();
                $table->char('id_hash', 64)->unique();
                $table->string('username', 255);
                $table->string('kind', 16);
                $table->string('client', 16);
                $table->text('pending_secret')->nullable();
                $table->unsignedSmallInteger('attempts')->default(0);
                $table->timestamp('expires_at');
                $table->timestamp('consumed_at')->nullable();
                $table->timestamp('created_at')->nullable();
                $table->index('username');
            });
        }
    }

    public function down(): void
    {
        $this->wgw()->dropIfExists('auth_challenges');
        $this->wgw()->dropIfExists('mfa_recovery_codes');
        $this->wgw()->dropIfExists('user_mfa');
    }
};
