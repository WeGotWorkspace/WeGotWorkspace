<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use Illuminate\Database\Schema\Blueprint;

return new class extends WgwMigration
{
    public function up(): void
    {
        if (! $this->wgwHasTable('wgw_auth_challenges') || $this->wgwHasColumn('wgw_auth_challenges', 'client')) {
            return;
        }

        $this->wgw()->table('wgw_auth_challenges', function (Blueprint $table): void {
            $table->string('client', 8)->default('spa');
        });
    }

    public function down(): void
    {
        if (! $this->wgwHasTable('wgw_auth_challenges') || ! $this->wgwHasColumn('wgw_auth_challenges', 'client')) {
            return;
        }

        $this->wgw()->table('wgw_auth_challenges', function (Blueprint $table): void {
            $table->dropColumn('client');
        });
    }
};
