<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use Illuminate\Database\Schema\Blueprint;

return new class extends WgwMigration
{
    public function up(): void
    {
        if (! $this->wgwHasTable('users') || $this->wgwHasColumn('users', 'access_token_epoch')) {
            return;
        }

        $this->wgw()->table('users', function (Blueprint $table): void {
            $table->unsignedInteger('access_token_epoch')->default(0);
        });
    }

    public function down(): void
    {
        if (! $this->wgwHasTable('users') || ! $this->wgwHasColumn('users', 'access_token_epoch')) {
            return;
        }

        $this->wgw()->table('users', function (Blueprint $table): void {
            $table->dropColumn('access_token_epoch');
        });
    }
};
