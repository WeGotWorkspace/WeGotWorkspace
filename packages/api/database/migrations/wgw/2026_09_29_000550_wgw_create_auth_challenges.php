<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use Illuminate\Database\Schema\Blueprint;

return new class extends WgwMigration
{
    public function up(): void
    {
        if ($this->wgwHasTable('wgw_auth_challenges')) {
            return;
        }

        $this->wgw()->create('wgw_auth_challenges', function (Blueprint $table): void {
            $table->id();
            $table->string('id_hash', 64)->unique();
            $table->string('username');
            $table->string('kind', 32);
            $table->text('pending_secret')->nullable();
            $table->unsignedSmallInteger('attempts')->default(0);
            $table->timestamp('expires_at');
            $table->timestamp('consumed_at')->nullable();
            $table->timestamp('created_at');
            $table->index('username');
        });
    }

    public function down(): void
    {
        if ($this->wgwHasTable('wgw_auth_challenges')) {
            $this->wgw()->drop('wgw_auth_challenges');
        }
    }
};
