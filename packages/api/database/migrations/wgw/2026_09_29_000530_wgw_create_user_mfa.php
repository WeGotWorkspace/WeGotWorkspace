<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use Illuminate\Database\Schema\Blueprint;

return new class extends WgwMigration
{
    public function up(): void
    {
        if ($this->wgwHasTable('wgw_user_mfa')) {
            return;
        }

        $this->wgw()->create('wgw_user_mfa', function (Blueprint $table): void {
            $table->id();
            $table->string('username')->unique();
            $table->text('totp_secret')->nullable();
            $table->timestamp('enabled_at')->nullable();
            $table->unsignedBigInteger('last_used_step')->nullable();
            $table->timestamp('suggest_snoozed_until')->nullable();
        });
    }

    public function down(): void
    {
        if ($this->wgwHasTable('wgw_user_mfa')) {
            $this->wgw()->drop('wgw_user_mfa');
        }
    }
};
