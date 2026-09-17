<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use Illuminate\Database\Schema\Blueprint;

return new class extends WgwMigration
{
    public function up(): void
    {
        if (! $this->wgwHasTable('users') || $this->wgwHasColumn('users', 'enabled')) {
            return;
        }

        $this->wgw()->table('users', function (Blueprint $table): void {
            $table->boolean('enabled')->default(true);
        });
    }

    public function down(): void
    {
        if (! $this->wgwHasTable('users') || ! $this->wgwHasColumn('users', 'enabled')) {
            return;
        }

        $this->wgw()->table('users', function (Blueprint $table): void {
            $table->dropColumn('enabled');
        });
    }
};
