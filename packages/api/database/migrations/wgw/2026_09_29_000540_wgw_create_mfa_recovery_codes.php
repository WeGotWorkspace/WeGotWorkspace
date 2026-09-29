<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use Illuminate\Database\Schema\Blueprint;

return new class extends WgwMigration
{
    public function up(): void
    {
        if ($this->wgwHasTable('wgw_mfa_recovery_codes')) {
            return;
        }

        $this->wgw()->create('wgw_mfa_recovery_codes', function (Blueprint $table): void {
            $table->id();
            $table->string('username');
            $table->string('code_hash', 64);
            $table->timestamp('used_at')->nullable();
            $table->timestamp('created_at');
            $table->index(['username', 'code_hash']);
        });
    }

    public function down(): void
    {
        if ($this->wgwHasTable('wgw_mfa_recovery_codes')) {
            $this->wgw()->drop('wgw_mfa_recovery_codes');
        }
    }
};
