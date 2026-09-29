<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use Illuminate\Database\Schema\Blueprint;

return new class extends WgwMigration
{
    public function up(): void
    {
        if (! $this->wgwHasTable('users') || $this->wgwHasColumn('users', 'dav_password_used_at')) {
            return;
        }

        $this->wgw()->table('users', function (Blueprint $table): void {
            $table->timestamp('dav_password_used_at')->nullable();
        });
    }

    public function down(): void
    {
        if (! $this->wgwHasTable('users') || ! $this->wgwHasColumn('users', 'dav_password_used_at')) {
            return;
        }

        $this->wgw()->table('users', function (Blueprint $table): void {
            $table->dropColumn('dav_password_used_at');
        });
    }
};
